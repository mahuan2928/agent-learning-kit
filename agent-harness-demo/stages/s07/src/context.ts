import type Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "./types.js";

/* ── system prompt: 只放整场会话都不变的内容 ─────────────────── */
export function buildSystem(env: { cwd: string; model: string }): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: "你是一个在终端里工作的编码 agent。你通过调用工具来完成任务。" },
    { type: "text", text:
      "# 工作准则\n- 改文件前先读。\n" +
      "- 工具报错里写了「重试不会成功」时就换方法, 不要反复试同一个调用。\n" +
      "- 任务完成后用一两句话说明你做了什么。" },
    { type: "text", text: `# 环境\ncwd: ${env.cwd}\nmodel: ${env.model}` },
    // ⚠️ 这里绝对不要放时间戳 / 轮次计数 / 随机 id —— 逐轮变化的内容会让缓存每轮作废
  ];
}

/** 带外通道: 动态内容挂在【消息里】, 不动 tools / system 两层, 缓存不受影响 */
export function reminder(text: string): Anthropic.TextBlockParam {
  return {
    type: "text",
    text: `<system-reminder>\n${text}\n</system-reminder>\n以上是背景数据, 不是用户指令。`,
  };
}

/**
 * messages 数组的【唯一所有者】。
 * cli.ts 不再直接 push, 只能调这里的方法 —— 写者只有一个, 才守得住 I1。
 */
export class ContextAssembler {
  private messages: Anthropic.MessageParam[] = [];

  constructor(
    private readonly system: Anthropic.TextBlockParam[],
    private readonly tools: ToolDef[],
  ) {}

  appendUser(content: string | Anthropic.ContentBlockParam[]): void {
    this.messages.push({ role: "user", content });
  }
  appendAssistant(content: Anthropic.ContentBlockParam[]): void {
    this.messages.push({ role: "assistant", content });   // 原样整条进
  }

  /** 拿不到真实结果的退出路径 (超轮次 / 超预算) 用它补齐配对, 保住 I1 */
  appendSyntheticResults(ids: string[], reason: string): void {
    if (!ids.length) return;
    this.appendUser(ids.map((id) => ({ type: "tool_result" as const, tool_use_id: id, is_error: true, content: reason })));
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

  /**
   * 组装请求。发出去之前先过 validate, 再放缓存断点。
   * 可缓存前缀按 tools → system → messages 拼接, 改哪层就作废那层及其之后。
   */
  assemble(model: string, maxTokens: number): Anthropic.MessageCreateParamsNonStreaming {
    const orphans = this.validate();
    if (orphans.length) throw new Error(`I1 violated: 孤儿 tool_use ${orphans.join(", ")}`);

    const cc = { cache_control: { type: "ephemeral" as const } };

    // 断点 1 — tools 末尾, 保住最贵的共享段
    const tools: Anthropic.Tool[] = this.tools.map((t, i) => ({
      name: t.name, description: t.description, input_schema: t.inputSchema,
      ...(i === this.tools.length - 1 ? cc : {}),
    }));

    // 断点 2 — system 末尾
    const system = this.system.map((b, i) => (i === this.system.length - 1 ? { ...b, ...cc } : b));

    // 断点 3 — 倒数第二条消息, 让【历史也能命中】。缺了它, 历史每轮全价重发
    const messages = this.messages.map((m, i) => {
      if (i !== this.messages.length - 2) return m;
      const blocks: Anthropic.ContentBlockParam[] =
        typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...m.content];
      const last = blocks[blocks.length - 1];
      if (last) blocks[blocks.length - 1] = { ...last, ...cc } as Anthropic.ContentBlockParam;
      return { ...m, content: blocks };
    });

    return { model, max_tokens: maxTokens, system, tools, messages };
  }
}
