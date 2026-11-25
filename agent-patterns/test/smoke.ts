/**
 * 冒烟测试: 用假的 API 把六个脚本从头跑到尾, 只验证「接线」——
 * 调用参数能组出来、循环能结束、输出能打印。模型质量要用真 API 看。
 * 用法: npx tsx test/smoke.ts
 */
import { client } from "../src/lib.js";

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const msg = (content: any[], stop = "end_turn") =>
  ({ id: "msg_x", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_details: null, usage });
const txt = (text: string) => ({ type: "text", text, citations: null });
const promptOf = (p: any) => { const m = p.messages[p.messages.length - 1]; return typeof m.content === "string" ? m.content : JSON.stringify(m.content); };
const seen: string[] = [];

const REPLY = "このたびはご来店いただき、誠にありがとうございます。お待たせしてしまい、ご不快な思いをおかけしましたこと、心よりお詫び申し上げます。ご予約時のご案内とお席の準備について、スタッフ間の連携を見直し、待ち時間が発生した際には状況をすぐにご説明できるよう改善いたします。またのご来店の際には、気持ちよくお過ごしいただけるよう努めてまいります。";

(client.beta.messages as any).parse = async (p: any) => {
  seen.push(`parse:${p.model}`);
  if (!p.output_config?.format) throw new Error("parse without format");
  const q = promptOf(p);
  const inq = [...q.matchAll(/<inquiry>([^<]*)<\/inquiry>/g)].pop()?.[1] ?? "";   // 指示文中の「<inquiry>」と混同しない
  let out: unknown;
  if (q.includes("要件を抽出")) out = { company: "サンプルダイニング", industry: "飲食", storeCount: 47, pains: ["紙の記録"], existingSystems: [{ name: "kintone", replaceable: false }], pilotScope: "10店舗", decisionDeadline: "年度内", budget: null, securityReview: true };
  else if (q.includes("分類だけ")) out = { category: /無視/.test(inq) ? "injection" : /態度/.test(inq) ? "complaint" : /えっと/.test(inq) ? "other" : "faq", confidence: /えっと/.test(inq) ? 0.4 : 0.9, reason: "stub" };
  else if (q.includes("レビュアー")) out = { findings: [{ severity: "high", section: "1", quote: "全45店舗", issue: "47店と矛盾", fix: "47店舗" }] };
  else if (q.includes("評価してください")) out = { specific: { pass: true, note: "" }, apology: { pass: true, note: "" }, action: { pass: true, note: "" }, tone: { pass: true, note: "" } };
  else if (q.includes("判定してください")) out = { injection: /無視/.test(inq), reason: "stub" };
  else if (q.includes("ワーカーに割り振って")) out = { tasks: [{ files: ["S01_新宿東口.csv", "S02_渋谷道玄坂.csv", "S03_池袋西口.csv"], instruction: "前週比を見る" }, { files: ["S04_上野.csv", "S05_川崎.csv", "S06_大宮.csv"], instruction: "前週比を見る" }] };
  else throw new Error("unknown parse prompt: " + q.slice(0, 60));
  return { ...msg([txt(JSON.stringify(out))]), parsed_output: out };
};

(client.beta.messages as any).create = async (p: any) => {
  seen.push(`create:${p.model}:${p.betas ? "fallback" : "-"}`);
  if (p.tool_choice && p.tool_choice.type !== "auto") throw new Error("forced tool_choice is a 400 on this model");
  const last = p.messages[p.messages.length - 1];
  if (p.tools?.length) {
    if (typeof last.content === "string") {
      const tool = p.tools[0].name;
      const input = tool === "search_kb" ? { query: last.content.split("質問: ")[1] ?? "データ" }
                                         : { file: (last.content.match(/S0\d_[^,\s]+\.csv/) ?? ["S01_新宿東口.csv"])[0] };
      return msg([{ type: "tool_use", id: "toolu_1", name: tool, input }], "tool_use");
    }
    const res = String(last.content[0].content);
    const id = res.match(/\[([0-9a-z_]+#\d+)\]/)?.[1];
    return msg([txt(id ? `回答です[${id}]。` : `集計: ${res.slice(0, 40)}`)]);
  }
  const q = typeof last.content === "string" ? last.content : "";
  if (q.includes("返信文")) return msg([txt(REPLY)]);
  return msg([txt("1. 現状の課題（47店舗）\n2. 既存システムを置き換えない連携\n3. 情報セキュリティへの配慮\n4. 次回確認事項")]);
};

const realExit = process.exit;
for (const p of ["p1-chaining", "p2-routing", "p3-parallel", "p4-orchestrator", "p5-evaluator", "p6-rag"]) {
  (process as any).exit = (c?: number) => { throw Object.assign(new Error("exit"), { code: c }); };
  try { await import(`../src/${p}.ts`); console.log(`\n✅ ${p} ran to the end\n`); }
  catch (e: any) { if (e?.message === "exit" && !e.code) console.log(`\n✅ ${p} exited 0\n`); else { console.log(`\n❌ ${p}:`, e); realExit(1); } }
}
process.exit = realExit;
const fb = seen.filter((s) => s.includes("haiku") && s.includes("fallback"));
console.log(`calls ${seen.length} · haiku に fallback を付けた回数 ${fb.length} (0 であるべき)`);
