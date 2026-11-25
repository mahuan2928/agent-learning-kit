/** 模式 5 的机械检查。纯函数, 单独放一个文件方便离线测试 */
import { bannedTermsIn } from "./rules.js";

/** 返回不合格项 (空数组 = 通过) */
export function mechanicalChecks(reply: string, reviewText: string): string[] {
  const out: string[] = [];
  const len = [...reply.replace(/\s/g, "")].length;
  if (len < 120) out.push(`短すぎます (${len}字、120字以上)`);
  if (len > 250) out.push(`長すぎます (${len}字、250字以内)`);

  // 口コミに出てきたスタッフ名を返信で繰り返さない (個人が特定される)
  const NOT_NAMES = new Set(["店員", "客", "お客", "皆", "スタッフ", "店長", "店員さん"]);
  for (const m of reviewText.matchAll(/([一-龥ァ-ヴー]{1,6})さん/g))
    if (!NOT_NAMES.has(m[1]!) && reply.includes(m[1]!)) out.push(`スタッフ名「${m[1]}」を返信に書かないでください`);

  for (const w of bannedTermsIn(reply)) out.push(`社内用語「${w}」は使わないでください`);
  if (/AI|自動生成|ChatGPT|Claude/i.test(reply)) out.push("AI が書いたことが分かる表現は使わないでください");
  return out;
}
