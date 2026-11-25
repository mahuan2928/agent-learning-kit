/**
 * 端到端评测 (需要 API): 46 道题全部走一遍状态图, 按题型统计。
 * 用法:
 *   npm run e2e                     # 完整配置
 *   npm run e2e -- --no-rewrite     # 消融: 关掉改写
 *   npm run e2e -- --no-rerank --no-verify --keep-stale
 * 每次结果写到 results/e2e-<配置>.json, 两次之间直接比较。
 *
 * 判分:
 *   有标准答案的题: 没拒答 + Haiku 判定回答包含要点 = 正确
 *   没有答案的题 (noanswer / 无权限): 拒答或走到 fallback = 正确
 *   另外单独统计: 越权引用、引用了旧版、是否引用到了正确的文档
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { loadDocs } from "./corpus.js";
import { chunk } from "./chunkers.js";
import { Index } from "./retrieve.js";
import { buildGraph, initialState, refused, renderAnswer, DEFAULTS, type Config } from "./rag-graph.js";
import { askJSON, trace, FAST } from "./lib.js";
import { loadQuestions, pct, type QType } from "./evalset.js";

const flags = new Set(process.argv.slice(2));
const cfg: Config = { ...DEFAULTS,
  rewrite: !flags.has("--no-rewrite"), rerank: !flags.has("--no-rerank"),
  verify: !flags.has("--no-verify"), dropSuperseded: !flags.has("--keep-stale") };
const label = [...flags].map((f) => f.replace(/^--/, "")).join("+") || "full";

const docs = loadDocs();
const chunks = chunk(docs, "section-300");
const index = await Index.build(chunks);
const aclOf = new Map(chunks.map((c) => [c.id, c.acl]));
const g = buildGraph(index, cfg);
const Judge = z.object({ correct: z.boolean(), reason: z.string() });

interface Row {
  id: string; type: QType; correct: boolean; error?: string; role?: string; declined?: boolean; path?: string;
  citedGoldDoc?: boolean | null; leaked?: string[]; citedStale?: string[]; confidence?: number; ms?: number; usd?: number; answer?: string;
}
const rows: Row[] = [];
for (const q of loadQuestions()) {
  const usd0 = trace.reduce((s, t) => s + t.usd, 0), t0 = Date.now();
  let out;
  try { out = await g.invoke(initialState(q.q, q.role)); }
  catch (e) { rows.push({ id: q.id, type: q.type, correct: false, error: String(e) }); console.log(`${q.id} ERROR ${e}`); continue; }

  const text = renderAnswer(out.answer);
  const declined = refused(out.answer) || out.path.includes("fallback");
  const cited = [...new Set(out.answer.flatMap((s) => s.citations.map((c) => c.chunkId)))];
  let correct: boolean;
  if (q.gold.length === 0) correct = declined;
  else if (declined) correct = false;
  else correct = (await askJSON(Judge,
    `質問への回答が、期待される要点を正しく含んでいるか判定してください。表現の違いは問いません。要点と矛盾する内容があれば false。\n` +
    `質問: ${q.q}\n期待される要点: ${q.answer}\n回答: ${text}`,
    { step: `judge ${q.id}`, model: FAST, effort: "low", maxTokens: 800 })).correct;

  const row: Row & { path: string; leaked: string[]; citedStale: string[]; ms: number } = {
    id: q.id, type: q.type, role: q.role, correct, declined, path: out.path.join(">"),
    citedGoldDoc: q.gold.length ? q.gold.every((gd) => cited.some((c) => c.startsWith(`${gd.doc}#`))) : null,
    leaked: cited.filter((c) => !aclOf.get(c)?.includes(q.role)),
    citedStale: cited.filter((c) => q.stale_docs.some((d) => c.startsWith(`${d}#`))),
    confidence: Math.round(out.confidence * 100) / 100,
    ms: Date.now() - t0, usd: Math.round((trace.reduce((s, t) => s + t.usd, 0) - usd0) * 1e4) / 1e4,
    answer: text,
  };
  rows.push(row);
  console.log(`${q.id.padEnd(4)} ${correct ? "✓" : "✗"} ${q.type.padEnd(10)} ${row.path.padEnd(52)} ${text.slice(0, 60).replace(/\n/g, " ")}`);
}

const ok = rows.filter((r) => r.correct).length;
const types: QType[] = ["keyword", "paraphrase", "table", "stale", "acl", "noanswer", "multi"];
const byType = Object.fromEntries(types.map((t) => {
  const rs = rows.filter((r) => r.type === t);
  return [t, `${rs.filter((r) => r.correct).length}/${rs.length}`];
}));
const full = rows.filter((r) => !r.error) as (Row & { path: string; leaked: string[]; citedStale: string[]; ms: number })[];
const summary = {
  config: cfg, label, accuracy: ok / rows.length, byType,
  leaked: full.filter((r) => r.leaked.length).map((r) => r.id),
  citedStale: full.filter((r) => r.citedStale.length).map((r) => r.id),
  fallbackRate: full.filter((r) => r.path.includes("fallback")).length / rows.length,
  avgMs: Math.round(full.reduce((s, r) => s + r.ms, 0) / Math.max(1, full.length)),
  totalUsd: Math.round(trace.reduce((s, t) => s + t.usd, 0) * 1e4) / 1e4,
};
console.log(`\n[${label}] 正解率 ${pct(summary.accuracy)} (${ok}/${rows.length})`);
console.log(`  題型別: ${types.map((t) => `${t} ${byType[t]}`).join(" · ")}`);
console.log(`  越権引用 ${summary.leaked.length} · 旧版引用 ${summary.citedStale.length} · fallback 率 ${pct(summary.fallbackRate)} · 平均 ${summary.avgMs}ms · 合計 $${summary.totalUsd}`);
mkdirSync("results", { recursive: true });
writeFileSync(`results/e2e-${label}.json`, JSON.stringify({ summary, rows }, null, 2));
console.log(`→ results/e2e-${label}.json`);
