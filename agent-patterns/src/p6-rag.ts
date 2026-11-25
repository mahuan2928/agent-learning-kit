/**
 * 模式 6 · Agentic RAG (检索增强 + agent 自主检索)
 * 案例: 顧客のセキュリティチェックシートに、社内資料だけを根拠に回答する (出典つき)
 *
 *   質問 ─→ Agent (工具循环, 最多 6 轮)
 *             ├ search_kb(query)  → 前 3 块 + 分数   (分数低就自己改写 query 再搜)
 *             └ 写回答, 每句后面带 [doc#n]
 *          ─→ 引用核验 (代码): 出处存在? 是这次检索到的?  ──不过──→ 标记「要人工确认」
 *
 * 和「固定 RAG 流水线」(检索一次 → 生成) 的区别: 检索几次、用什么词, 由模型决定。
 * 适合问题措辞和资料措辞对不上的场景 (客户写「BCP」, 资料写「事業継続」)。
 * 资料里没有的, 必须答「資料に記載なし」—— 这比答错便宜得多。
 */
import { toolLoop, printTrace, FAST, type Tool } from "./lib.js";
import { loadChunks, BM25, verifyCitations } from "./rag-index.js";

const chunks = loadChunks();
const index = new BM25(chunks);
const allIds = new Set(chunks.map((c) => c.id));

const QUESTIONS = [
  "データはどこの国に保存されますか？バックアップは海外に出ますか？",
  "BCPについて教えてください。障害時に何時間で復旧しますか？",
  "ISMAPに登録されていますか？",
  "SSOとMFAに対応していますか？ログは何日分残りますか？",
  "ペネトレーションテストの実施頻度を教えてください。",          // 资料里没有 → 应该答「記載なし」
];

for (const q of QUESTIONS) {
  const retrieved = new Set<string>();
  const searchTool: Tool = {
    name: "search_kb",
    description:
      "社内のセキュリティ資料を検索し、関連する小節を最大3件返す。各結果に id とスコアがある。" +
      "スコアが低い(2未満)・内容がずれている場合は、言い換えた語（例: BCP→事業継続、MFA→多要素認証）で再検索すること。",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    run: ({ query }: { query: string }) => {
      const hits = index.search(query, 3);
      hits.forEach((h) => retrieved.add(h.chunk.id));
      return hits.length
        ? hits.map((h) => `[${h.chunk.id}] (score ${h.score}) ${h.chunk.title}\n${h.chunk.text}`).join("\n\n")
        : "該当なし。別の言い方で検索してください。";
    },
  };

  const r = await toolLoop(
    `顧客のセキュリティチェックシートの質問に、search_kb で見つけた社内資料だけを根拠に回答してください。\n` +
    `- 各文の末尾に根拠の id を [02_datacenter#1] の形式で付けること\n` +
    `- 資料で確認できないことは推測せず「社内資料に記載がないため、担当部署に確認します」と書くこと\n` +
    `- 敬体で3文以内\n\n質問: ${q}`,
    [searchTool], { step: `rag`, model: FAST, effort: "low", maxTurns: 6 });

  // 引用核验: 代码做, 不再问模型
  const v = verifyCitations(r.text, retrieved, allIds);
  const noAnswer = /記載がない/.test(r.text);
  const status =
    v.unknown.length ? `NG 存在しない出典 ${v.unknown.join(",")}` :
    v.notRetrieved.length ? `NG 検索していない出典 ${v.notRetrieved.join(",")}` :
    v.cited.length === 0 && !noAnswer ? "NG 出典なし" : "OK";
  const queries = r.toolCalls.map((c) => (c.input as { query: string }).query);

  console.log(`\nQ: ${q}\n検索 ${queries.length} 回: ${queries.join(" → ")}\nA: ${r.text}\n引用チェック: ${status}${status === "OK" ? "" : " → 人が確認"}`);
}
printTrace();

