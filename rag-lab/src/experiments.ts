/**
 * 离线实验 E1–E6: 全部在本机跑, 不调 API, 结果写到 results/experiments.json。
 * 用法: npm run exp            (全部)
 *       npm run exp -- E2 E3   (只跑指定的)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadDocs } from "./corpus.js";
import { chunk, STRATEGIES, type Chunk, type Strategy } from "./chunkers.js";
import { Index, type SearchOpts } from "./retrieve.js";
import { loadQuestions, hitAt, reciprocalRank, pct, avg, type Question } from "./evalset.js";

const only = process.argv.slice(2);
const run = (id: string) => only.length === 0 || only.includes(id);
const docs = loadDocs();
const questions = loadQuestions();
const answerable = questions.filter((q) => q.gold.length > 0);
const results: Record<string, unknown> = {};
const indexes = new Map<Strategy, Index>();
const indexOf = async (s: Strategy) => { if (!indexes.has(s)) indexes.set(s, await Index.build(chunk(docs, s))); return indexes.get(s)!; };

async function score(ix: Index, qs: Question[], o: SearchOpts) {
  const r1: boolean[] = [], r3: boolean[] = [], r5: boolean[] = [], rr: number[] = [], ms: number[] = [];
  for (const q of qs) {
    const t0 = Date.now();
    const hits = (await ix.search(q.q, { k: 5, role: q.role, ...o })).map((h) => h.chunk);
    ms.push(Date.now() - t0);
    r1.push(hitAt(q, hits, 1)); r3.push(hitAt(q, hits, 3)); r5.push(hitAt(q, hits, 5)); rr.push(reciprocalRank(q, hits));
  }
  const rate = (xs: boolean[]) => xs.filter(Boolean).length / Math.max(1, xs.length);
  return { n: qs.length, recall1: rate(r1), recall3: rate(r3), recall5: rate(r5), mrr: avg(rr), msPerQuery: Math.round(avg(ms)),
           missed: qs.filter((_, i) => !r5[i]).map((q) => q.id) };
}
const row = (label: string, s: Awaited<ReturnType<typeof score>>) =>
  console.log(`  ${label.padEnd(18)} R@1 ${pct(s.recall1).padStart(4)}  R@3 ${pct(s.recall3).padStart(4)}  R@5 ${pct(s.recall5).padStart(4)}  MRR ${s.mrr.toFixed(2)}  ${String(s.msPerQuery).padStart(4)}ms  miss@5: ${s.missed.join(",") || "-"}`);

/* E1 切块策略 */
if (run("E1")) {
  console.log(`\nE1 切块策略 (混合检索, ${answerable.length} 题)`);
  const out: Record<string, unknown> = {};
  for (const s of STRATEGIES) {
    const ix = await indexOf(s);
    const r = await score(ix, answerable, { mode: "hybrid" });
    const lens = ix.chunks.map((c) => c.text.length);
    out[s] = { ...r, chunks: ix.chunks.length, avgLen: Math.round(avg(lens)) };
    row(`${s} (${ix.chunks.length}块)`, r);
  }
  results.E1 = out;
}

/* E2 召回方式 */
if (run("E2")) {
  const ix = await indexOf("section+ctx");
  console.log(`\nE2 召回方式 (section+ctx)`);
  const out: Record<string, unknown> = {};
  for (const mode of ["bm25-raw", "bm25", "vector", "hybrid-raw", "hybrid"] as const) {
    const all = await score(ix, answerable, { mode });
    const byType: Record<string, number> = {};
    for (const t of ["keyword", "paraphrase", "table"] as const)
      byType[t] = (await score(ix, answerable.filter((q) => q.type === t), { mode })).recall3;
    out[mode] = { ...all, byTypeRecall3: byType };
    row(mode, all);
    console.log(`  ${"".padEnd(18)} R@3 按题型: keyword ${pct(byType.keyword!)} · paraphrase ${pct(byType.paraphrase!)} · table ${pct(byType.table!)}`);
  }
  results.E2 = out;
}

/* E3 重排 */
if (run("E3")) {
  const ix = await indexOf("section+ctx");
  console.log(`\nE3 重排 (section+ctx, 融合后 top 20 → cross-encoder)`);
  const base = await score(ix, answerable, { mode: "hybrid" });
  const rr = await score(ix, answerable, { mode: "hybrid", rerank: true });
  row("hybrid", base); row("hybrid + rerank", rr);
  results.E3 = { hybrid: base, rerank: rr };
}

/* E4 权限过滤 */
if (run("E4")) {
  const ix = await indexOf("section+ctx");
  console.log(`\nE4 权限过滤`);
  const leaks: Record<string, string[]> = {};
  let leakQ = 0;
  for (const q of questions) {
    const hits = await ix.search(q.q, { k: 5, filter: "none" });
    const bad = hits.filter((h) => !h.chunk.acl.includes(q.role)).map((h) => h.chunk.id);
    if (bad.length) { leakQ++; leaks[q.id] = bad; }
  }
  console.log(`  不过滤: ${leakQ}/${questions.length} 题的 top 5 里出现了提问者无权查看的块`);
  for (const [id, b] of Object.entries(leaks)) console.log(`    ${id} (${questions.find((q) => q.id === id)!.role}) → ${b.join(" ")}`);
  // pre vs post: 在「问的人有权限、但候选里混着大量无权限块」时, post-filter 会把结果挤没
  const counts = async (filter: "pre" | "post") => {
    let empty = 0, total = 0;
    for (const q of questions) { const h = await ix.search(q.q, { k: 5, role: q.role, filter }); total += h.length; if (!h.length) empty++; }
    return { avgResults: total / questions.length, emptyQueries: empty };
  };
  const pre = { ...(await score(ix, answerable, { mode: "hybrid", filter: "pre" })), ...(await counts("pre")) };
  const post = { ...(await score(ix, answerable, { mode: "hybrid", filter: "post" })), ...(await counts("post")) };
  row("pre-filter", pre); console.log(`  ${"".padEnd(18)} 平均返回 ${pre.avgResults.toFixed(1)} 块`);
  row("post-filter", post); console.log(`  ${"".padEnd(18)} 平均返回 ${post.avgResults.toFixed(1)} 块`);
  results.E4 = { leakQuestions: leakQ, total: questions.length, leaks, pre, post };
}

/* E5 新旧版本 */
if (run("E5")) {
  const ix = await indexOf("section+ctx");
  console.log(`\nE5 新旧版本 (经费规程 2024 vs 2026)`);
  const stale = questions.filter((q) => q.type === "stale");
  const out: Record<string, unknown> = {};
  for (const drop of [false, true]) {
    const detail = [];
    for (const q of stale) {
      const hits = (await ix.search(q.q, { k: 3, role: q.role, dropSuperseded: drop })).map((h) => h.chunk);
      const first = hits.find((c) => c.docId === "D02" || c.docId === "D03");
      detail.push({ id: q.id, top3: hits.map((c) => c.id), firstVersion: first?.docId ?? "-", staleInTop3: hits.some((c) => c.superseded) });
    }
    const label = drop ? "去掉旧版" : "不处理";
    const staleFirst = detail.filter((d) => d.firstVersion === "D02").length;
    console.log(`  ${label}: 旧版排在新版前面 ${staleFirst}/${stale.length} 题 · top 3 混入旧版 ${detail.filter((d) => d.staleInTop3).length}/${stale.length} 题`);
    for (const d of detail) console.log(`    ${d.id} top3 = ${d.top3.join(" ")}`);
    out[drop ? "dropSuperseded" : "none"] = detail;
  }
  results.E5 = out;
}

/* E6 拒答阈值: 用重排分数区分「资料里有答案」和「没有」 */
if (run("E6")) {
  const ix = await indexOf("section+ctx");
  console.log(`\nE6 拒答阈值 (重排后 top 1 的分数)`);
  const rows: { id: string; type: string; top1: number; answerable: boolean }[] = [];
  for (const q of questions) {
    const [h] = await ix.search(q.q, { k: 1, role: q.role, dropSuperseded: true, rerank: true });
    rows.push({ id: q.id, type: q.type, top1: h ? Math.round(h.score * 100) / 100 : -99, answerable: q.gold.length > 0 });
  }
  rows.sort((a, b) => b.top1 - a.top1);
  for (const r of rows) console.log(`  ${r.top1.toFixed(2).padStart(7)}  ${r.answerable ? "  有答案" : "■ 无答案"}  ${r.id} (${r.type})`);
  // 选阈值: 让「有答案被拒」+「无答案被答」最少
  let best = { t: 0, err: Infinity };
  for (const t of rows.map((r) => r.top1)) {
    const err = rows.filter((r) => (r.answerable ? r.top1 < t : r.top1 >= t)).length;
    if (err < best.err) best = { t, err };
  }
  const fn = rows.filter((r) => r.answerable && r.top1 < best.t).map((r) => r.id);
  const fp = rows.filter((r) => !r.answerable && r.top1 >= best.t).map((r) => r.id);
  console.log(`  → 阈值 ${best.t.toFixed(2)}: 误拒 ${fn.length} (${fn.join(",") || "-"}) · 误答 ${fp.length} (${fp.join(",") || "-"})`);
  results.E6 = { rows, threshold: best.t, falseRefuse: fn, falseAnswer: fp };
}

mkdirSync("results", { recursive: true });
const file = only.length ? `results/experiments-${only.join("-")}.json` : "results/experiments.json";
writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`\n→ ${file}`);
