/**
 * 模式 5 · Evaluator-Optimizer (评估-优化循环)
 * 案例: Google 口コミへの返信文。生成 → 评估 → 带着反馈重写, 直到合格或到达上限
 *
 *   Generator (主模型) ──草稿──→ ① 机械检查 (代码)  ──不合格──┐
 *        ▲                          │ 合格                     │
 *        │                          ▼                          │
 *        └──── 反馈 ◀── ② Judge (另一次调用, 按 rubric 打分) ◀──┘
 *                         │ 全项达标 → 采用
 *                         └ 3 轮仍不达标 → 交给人, 附上最后一版和未达标项
 *
 * 什么时候用: 有清楚的验收标准, 而且「被指出问题后改一版」确实会更好。
 * 关键: 先机械检查后 LLM 判分 (便宜的先拦); 裁判和生成分开调用, 裁判看不到生成时的想法;
 * 停止条件写死, 不让循环自己决定什么时候停。
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ask, askJSON, printTrace } from "./lib.js";
import { mechanicalChecks } from "./review-rules.js";

interface Review { id: string; store: string; stars: number; text: string }
const reviews: Review[] = JSON.parse(readFileSync("data/reviews.json", "utf8"));
const MAX_ROUNDS = 3;

const Rubric = z.object({
  specific:   z.object({ pass: z.boolean(), note: z.string() }).describe("口コミの具体的な内容（待ち時間・料理の温度など）に触れているか"),
  apology:    z.object({ pass: z.boolean(), note: z.string() }).describe("低評価なら、言い訳せずに謝罪しているか。高評価なら感謝が具体的か"),
  action:     z.object({ pass: z.boolean(), note: z.string() }).describe("改善策や再来店につながる一言があるか。できない約束をしていないか"),
  tone:       z.object({ pass: z.boolean(), note: z.string() }).describe("店舗として公開して問題ない敬語・温度感か"),
});

const system = "あなたは飲食店の店長として、Google の口コミに返信します。返信は公開されます。敬体で、120〜250字。";

for (const rv of reviews) {
  console.log(`\n=== ${rv.id} ★${rv.stars} ${rv.store} ===`);
  let feedback = "";
  let draft = "";
  let accepted = false;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    draft = await ask(
      `次の口コミへの返信文を書いてください。返信文だけを出力してください。\n<review stars="${rv.stars}">${rv.text}</review>` +
      (feedback ? `\n\n前回の返信案と、その評価です。指摘をすべて直してください。\n<previous>${draft}</previous>\n<feedback>\n${feedback}\n</feedback>` : ""),
      { step: `${rv.id} gen#${round}`, system, effort: "medium" });

    // ① 机械检查: 字数、个人名、内部用语。不合格就不花钱请裁判
    const mech = mechanicalChecks(draft, rv.text);
    if (mech.length) {
      feedback = mech.map((m) => `- ${m}`).join("\n");
      console.log(`  round ${round}: 機械チェック NG → ${mech.join(" / ")}`);
      continue;
    }

    // ② LLM 裁判: 独立调用, 只看口コミ和返信案
    const score = await askJSON(Rubric,
      `口コミへの店舗返信を評価してください。各項目について合否と理由を書いてください。厳しめに判定してください。\n` +
      `<review stars="${rv.stars}">${rv.text}</review>\n<reply>${draft}</reply>`,
      { step: `${rv.id} judge#${round}`, effort: "low" });
    const failed = Object.entries(score).filter(([, v]) => !v.pass);
    if (failed.length === 0) { accepted = true; console.log(`  round ${round}: 合格`); break; }

    feedback = failed.map(([k, v]) => `- ${k}: ${v.note}`).join("\n");
    console.log(`  round ${round}: Judge NG → ${failed.map(([k]) => k).join(", ")}`);
  }

  console.log(accepted ? `  採用:\n  ${draft}` : `  ${MAX_ROUNDS} 回で基準未達 → 店長が手直し\n  最終案: ${draft}\n  未達: ${feedback}`);
}
printTrace();
