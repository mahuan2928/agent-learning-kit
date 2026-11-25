/** 不依赖 SDK 的规则, 可以离线测试 */

/** 客户材料里不能出现的内部用语 (CLAUDE.md 的规则, 机械检查, 不交给模型) */
export const BANNED_TERMS = ["lark-cli", "MCP", "SubAgent", "サブエージェント", "Claude Code", "プロンプト"];
export function bannedTermsIn(text: string): string[] {
  return BANNED_TERMS.filter((t) => text.toLowerCase().includes(t.toLowerCase()));
}
