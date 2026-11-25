import type Anthropic from "@anthropic-ai/sdk";

/**
 * messages 数组的【唯一所有者】。
 * cli.ts 不再直接 push, 只能调这里的方法 —— 写者只有一个, 才守得住 I1。
 */
export class ContextAssembler {
  private messages: Anthropic.MessageParam[] = [];

  constructor(private readonly tools: Anthropic.Tool[]) {}

  appendUser(content: string | Anthropic.ContentBlockParam[]): void {
    this.messages.push({ role: "user", content });
  }
  appendAssistant(content: Anthropic.ContentBlockParam[]): void {
    this.messages.push({ role: "assistant", content });   // 原样整条进
  }

  /** I1: 每个 tool_use 都必须在【紧接着的下一条】user 消息里有配对的 tool_result */
  validate(): string[] {
    const orphans: string[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i]!;
      if (m.role !== "assistant" || typeof m.content === "string") continue;
      const ids = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
      if (ids.length === 0) continue;

      const next = this.messages[i + 1];
      const paired = new Set<string>();
      if (next?.role === "user" && Array.isArray(next.content))
        for (const b of next.content) if (b.type === "tool_result") paired.add(b.tool_use_id);

      for (const id of ids) if (!paired.has(id)) orphans.push(id);
    }
    return orphans;
  }

  /** 组装请求。发出去之前先过 validate —— 有孤儿就在本地抛错, 不让 API 回 400 */
  assemble(model: string, maxTokens: number): Anthropic.MessageCreateParamsNonStreaming {
    const orphans = this.validate();
    if (orphans.length) throw new Error(`I1 violated: 孤儿 tool_use ${orphans.join(", ")}`);
    return { model, max_tokens: maxTokens, tools: this.tools, messages: this.messages };
  }
}
