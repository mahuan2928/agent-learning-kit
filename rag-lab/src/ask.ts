/**
 * 单问调试: 打印状态图走过的每个节点和它更新了什么。
 * 用法: npm run ask -- --role staff "残業代はどう計算しますか"
 */
import { loadDocs, type Role } from "./corpus.js";
import { chunk } from "./chunkers.js";
import { Index } from "./retrieve.js";
import { buildGraph, initialState, renderAnswer } from "./rag-graph.js";
import { printTrace } from "./lib.js";

const args = process.argv.slice(2);
const ri = args.indexOf("--role");
const role = (ri >= 0 ? args.splice(ri, 2)[1] : "staff") as Role;
const question = args.join(" ");
if (!question) { console.error('用法: npm run ask -- --role staff "質問"'); process.exit(1); }

const index = await Index.build(chunk(loadDocs(), "section-300"));
const g = buildGraph(index);
const out = await g.invoke(initialState(question, role), {
  onStep: (node, u, ms) => {
    const show: string[] = [];
    if (u.route) show.push(`route=${u.route}`);
    if (u.queries) show.push(`queries=${JSON.stringify(u.queries)}`);
    if (u.docs) show.push(`docs=${u.docs.map((h) => `${h.chunk.id}(${h.score.toFixed(1)})`).join(" ")}`);
    if (u.retryCount !== undefined) show.push(`retry=${u.retryCount}`);
    if (u.verifyNote) show.push(u.verifyNote);
    if (u.fallbackReason) show.push(`fallback: ${u.fallbackReason}`);
    console.log(`  ${node.padEnd(9)} ${String(ms).padStart(5)}ms  ${show.join("  ")}`);
  },
});
console.log(`\n[${role}] ${question}\n→ ${renderAnswer(out.answer)}\n  path: ${out.path.join(" → ")}  confidence ${out.confidence.toFixed(2)}`);
printTrace();
