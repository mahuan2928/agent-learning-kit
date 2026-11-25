/**
 * 模式 1 · Prompt Chaining (提示链)
 * 案例: 走り書きのヒアリングメモ → 提案書の骨子 (日本語)
 *
 *   ① 抽出 (结构化)  →  ② Gate (代码)  →  ③ 生成骨子  →  ④ 检查 (代码) ─┐
 *                         │ 缺项                                │ 违规
 *                         └→ 输出追加确认问题, 停止              └→ 带着违规点重写一次
 *
 * 什么时候用: 步骤固定、每一步都能单独检查。把一个大 prompt 拆成几个小 prompt,
 * 换来的是「每一步的输出都能被代码验收」。
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ask, askJSON, bannedTermsIn, printTrace } from "./lib.js";

const notes = readFileSync("data/hearing-notes.md", "utf8");

/* ① 抽出: 让模型只做一件事 —— 把走り書き变成字段 */
const Requirements = z.object({
  company: z.string(),
  industry: z.string(),
  storeCount: z.number().nullable().describe("店舗数。メモにない場合は null"),
  pains: z.array(z.string()).describe("現場の課題。メモの言葉をなるべく残す"),
  existingSystems: z.array(z.object({ name: z.string(), replaceable: z.boolean() })),
  pilotScope: z.string().nullable(),
  decisionDeadline: z.string().nullable(),
  budget: z.string().nullable(),
  securityReview: z.boolean().describe("セキュリティ審査が必要か"),
});
const req = await askJSON(Requirements,
  `次のヒアリングメモから要件を抽出してください。メモに書かれていないことは推測せず null にしてください。\n\n${notes}`,
  { step: "1 extract", effort: "low" });
console.log("① 抽出結果:", JSON.stringify(req, null, 2));

/* ② Gate: 代码判断能不能往下走。缺的不是「让模型猜」, 而是「变成要问客户的问题」 */
const missing: string[] = [];
if (req.storeCount == null) missing.push("店舗数");
if (req.pains.length === 0) missing.push("現場の課題");
if (req.budget == null) missing.push("予算感");
if (req.decisionDeadline == null) missing.push("決裁時期");
// 予算は初回提案では欠けていても進める (よくあるケース)。止めるのは提案の前提が崩れる項目だけ
const blocking = missing.filter((m) => m !== "予算感");
if (blocking.length) {
  console.log(`\n② Gate: 前提が足りません (${blocking.join("・")})。次回ヒアリングで確認してください。`);
  printTrace();
  process.exit(0);
}
console.log(`\n② Gate: 通過 (未確認: ${missing.join("・") || "なし"})`);

/* ③ 生成: 只把结构化后的要件交给生成步骤, 不再给原始メモ —— 下游看到的输入是干净的 */
const system =
  "あなたは日本企業向けに業務システムを提案するソリューションアーキテクトです。" +
  "敬体（です・ます調）で、簡潔に書いてください。社内ツール名や技術用語は使わず、「自動化」「外部連携」と表現してください。";
const outlinePrompt = (extra = "") =>
  `以下の要件から、初回提案書の章立てと各章の要点（1〜2文）を作成してください。\n` +
  `必ず「既存システムは置き換えない」方針と、情報セキュリティへの配慮を章として含めてください。\n` +
  `未確認事項（${missing.join("・") || "なし"}）は最後の章「次回確認事項」にまとめてください。\n\n` +
  `要件:\n${JSON.stringify(req, null, 2)}${extra}`;
let outline = await ask(outlinePrompt(), { step: "3 outline", system, effort: "medium" });

/* ④ 检查: 能用代码判的绝不交给模型。违规就带着具体问题重写一次, 只重写一次 */
const problems = (t: string) => [
  ...bannedTermsIn(t).map((w) => `社内用語「${w}」が含まれています`),
  ...(req.storeCount && !t.includes(String(req.storeCount)) ? [`店舗数 ${req.storeCount} が本文にありません`] : []),
  ...(/セキュリティ/.test(t) ? [] : ["情報セキュリティの章がありません"]),
];
const p = problems(outline);
if (p.length) {
  console.log("\n④ Check: 修正が必要 →", p);
  outline = await ask(outlinePrompt(`\n\n前回の出力には次の問題がありました。直してください:\n- ${p.join("\n- ")}`),
    { step: "3 outline (retry)", system, effort: "medium" });
  const left = problems(outline);
  if (left.length) console.log("④ Check: 再生成後も残った問題 →", left, "(人手で直す)");
} else {
  console.log("\n④ Check: 問題なし");
}

console.log("\n③ 提案書骨子:\n" + outline);
printTrace();
