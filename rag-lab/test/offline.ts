/** 离线测试: 不调 API。用法: npm test */
import { StateGraph, END } from "../src/graph.js";
import { loadDocs } from "../src/corpus.js";
import { chunk } from "../src/chunkers.js";
import { tokenize } from "../src/bm25.js";
import { Index, rrf } from "../src/retrieve.js";
import { loadQuestions, hitAt } from "../src/evalset.js";

let fail = 0;
const t = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); if (!ok) fail++; };

/* graph */
type S = { n: number };
const g = new StateGraph<S>().addNode("inc", async (s) => ({ n: s.n + 1 }))
  .addConditionalEdges("inc", (s) => (s.n < 3 ? "inc" : END)).setEntryPoint("inc");
const r = await g.invoke({ n: 0 });
t("条件边循环到满足条件为止", r.n === 3 && r.path.length === 3, r.path.join(">"));
const loop = new StateGraph<S>().addNode("x", async () => ({})).addEdge("x", "x").setEntryPoint("x");
let threw = false; try { await loop.invoke({ n: 0 }, { maxSteps: 5 }); } catch { threw = true; }
t("maxSteps 拦住死循环", threw);

/* corpus / chunkers */
const docs = loadDocs();
t("13+1 份文档", docs.length === 14, String(docs.length));
t("D02 标记为已被取代", docs.find((d) => d.id === "D02")!.supersededBy === "D03");
const s300 = chunk(docs, "section-300");
t("section-300: Q/A 不拆开", s300.filter((c) => c.docId === "D14").every((c) => !/^A:/.test(c.text)), "");
t("section-300: 表不拆开", s300.some((c) => c.text.includes("| 1年6か月 | 11日 |") && c.text.includes("| 継続勤務年数 |")));
const over = s300.filter((c) => c.text.length > 300);
t("section-300: 超过 300 字的只能是单个不可拆单位 (一整张表)", over.every((c) => c.text.split("\n").every((l) => l.startsWith("|"))), over.map((c) => `${c.id}:${c.text.length}`).join(" "));
t("fixed-200: 会把表切开 (反例)", chunk(docs, "fixed-200").some((c) => c.text.includes("| 6年6か月以上 |") && !c.text.includes("| 継続勤務年数 |")));

/* tokenizer / rrf */
t("编号整体成词", tokenize("E-221が出た").includes("e-221"));
t("内容词模式丢掉平假名 bigram", !tokenize("どうやって計算されるの").includes("どう") && tokenize("どうやって計算されるの", false).includes("どう"));
const fused = rrf([[{ i: 1, score: 9 }, { i: 2, score: 1 }], [{ i: 2, score: 0.9 }, { i: 3, score: 0.8 }]]);
t("RRF: 两路都靠前的排第一", fused[0]!.i === 2, JSON.stringify(fused.map((x) => x.i)));

/* retrieval (本地 embedding, 首次会下载模型) */
const ix = await Index.build(s300);
const forbidden = await ix.search("店長の基本給はいくら", { k: 10, role: "manager" });
t("pre-filter: manager 搜不到 hr 文档", forbidden.every((h) => h.chunk.acl.includes("manager")));
const noFilter = await ix.search("店長の基本給はいくら", { k: 5, filter: "none" });
t("不过滤时会搜到 D09 (反例)", noFilter.some((h) => h.chunk.docId === "D09"));
const fresh = await ix.search("交通費の上限", { k: 5, role: "staff", dropSuperseded: true });
t("dropSuperseded: 不出现 D02", fresh.every((h) => h.chunk.docId !== "D02"));
const q = loadQuestions().find((x) => x.id === "K1")!;
t("K1 编号题 top3 命中", hitAt(q, (await ix.search(q.q, { k: 3, role: "staff" })).map((h) => h.chunk), 3));

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
