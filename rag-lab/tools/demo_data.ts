/**
 * 入门页的演示数据: 13 张「卡片」(取自 corpus 的小节) × 6 个示例问题,
 * 用本地 embedding 真实计算「按意思找」的相似度, 写到 tools/demo-data.json。
 * 用法: npx tsx tools/demo_data.ts
 */
import { writeFileSync } from "node:fs";
import { loadDocs } from "../src/corpus.js";
import { chunk } from "../src/chunkers.js";
import { embed, cosine } from "../src/models.js";
import { tokenize } from "../src/bm25.js";

const PICK = ["D01#3", "D01#4", "D01#5", "D02#1", "D03#1", "D04#2", "D05#2", "D06#1", "D06#4", "D11#1", "D12#3", "D13#1", "D13#2"];
const all = chunk(loadDocs(), "section");
const cards = PICK.map((id) => {
  const c = all.find((x) => x.id === id)!;
  let text = c.text;
  if (id === "D11#1") text = text.split("\n").filter((l) => /E-221|E-212|E-222/.test(l)).join("\n");     // 错误码只留 3 条
  if (id === "D01#4") text = text.replace(/\n\| 2年6か月[\s\S]*?\| 6年6か月以上 \| 20日 \|/, "\n| … | … |");  // 表格缩短
  return { id, doc: c.docTitle, heading: c.heading, text, old: c.superseded, updated: c.updatedAt };
});

const QUESTIONS = [
  { q: "交通費は1日いくらまで精算できますか？", answer: "D03#1" },
  { q: "残業代ってどうやって計算されるの？", answer: "D01#3" },
  { q: "POSにE-221と出ました。会計はできますか？", answer: "D11#1" },
  { q: "家族と食べに行くと安くなりますか？", answer: "D13#2" },
  { q: "仕事用のスマホをなくしてしまいました。", answer: "D06#4" },
  { q: "社員寮はありますか？", answer: null },
];

const cardVecs = await embed(cards.map((c) => `${c.doc} > ${c.heading}\n${c.text}`), "passage");
const questions = [];
for (const item of QUESTIONS) {
  const [qv] = await embed([item.q], "query");
  const vector = cardVecs.map((v) => Math.round(cosine(qv!, v) * 1000) / 1000);
  questions.push({ ...item, vector, qTokens: [...new Set(tokenize(item.q))] });
}
writeFileSync("tools/demo-data.json", JSON.stringify({ cards, questions }, null, 1));

// 打印出来核对讲解文字
for (const q of questions) {
  const kw = cards.map((c) => { const t = new Set(tokenize(`${c.heading} ${c.text}`)); return q.qTokens.filter((w) => t.has(w)).length; });
  const top = (xs: number[]) => xs.map((s, i) => [s, cards[i]!.id] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([s, id]) => `${id}(${s})`).join(" ");
  console.log(`${q.q}\n  答案=${q.answer}\n  按字: ${top(kw)}\n  按意思: ${top(q.vector)}`);
}
