import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, Gate, ResultSubtype, ToolDef, UsageTotals } from "./types.js";
import { ContextAssembler } from "./context.js";
import { executeBatch } from "./tools.js";

export interface LoopOptions {
  model: string;
  maxTokens: number;
  maxTurns: number;
  maxBudgetUsd: number;
  sessionId: string;
  /** 权限门要问人时调它。Core 不碰终端, 怎么问由前端决定 */
  ask: (question: string) => Promise<boolean>;
}

/**
 * turn 状态机。从 cli.ts 里拆出来, 写成 async generator:
 * 每个 yield 都是一个可以停下来的点, 前端只消费事件。
 */
export async function* runLoop(
  client: Anthropic, ctx: ContextAssembler, tools: ToolDef[],
  signal: AbortSignal, opt: LoopOptions,
): AsyncGenerator<AgentEvent> {
  const registry = new Map(tools.map((t) => [t.name, t]));
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  let turns = 0, retries = 0, budget = opt.maxTokens;
  let compactions = 0, contextTokens = 0;          // contextTokens = 上一次请求的完整输入大小

  const done = (subtype: ResultSubtype, result?: string, stopReason: string | null = null): AgentEvent =>
    ({ type: "result", subtype, result, usage, numTurns: turns, sessionId: opt.sessionId, stopReason });

  // 权限门 (Stage 04 的逻辑, 从 cli.ts 搬进来)
  const gate: Gate = async (tool, input) => {
    if (tool.effect === "none" || tool.effect === "reversible") return { allow: true, input };
    if (process.env.AGENT_YES === "1") return { allow: true, input };
    return (await opt.ask(`  ⚠ 允许 ${tool.name} ${JSON.stringify(input)} ? [y/N] `))
      ? { allow: true, input } : { allow: false, reason: "用户拒绝了这次调用" };
  };

  yield { type: "system", subtype: "init", data: { sessionId: opt.sessionId, model: opt.model, tools: tools.map((t) => t.name) } };

  while (true) {
    /* ① 组装 (含压缩判定) */
    if (ctx.length > 1 && contextTokens > COMPACT_AT) {
      if (++compactions > ContextAssembler.MAX_COMPACTIONS)
        return yield done("error_during_execution", "压缩反复失败: 存在超大单体输入");
      await ctx.simpleCompact((msgs) => summarize(client, opt.model, msgs));
      contextTokens = 0;
      yield { type: "system", subtype: "compact_boundary", data: { compactions } };
    }
    const req = ctx.assemble(opt.model, budget);

    /* ② 调模型 —— 流式 */
    let resp: Anthropic.Message;
    try {
      const stream = client.messages.stream(req, { signal });
      for await (const ev of stream) yield { type: "stream_event", event: ev };
      resp = await stream.finalMessage();
    } catch (e) {
      // 中断位置 ①: 流式输出中途。assistant 消息还没 append —— 整条不入历史, 没有孤儿要补
      if (signal.aborted) return yield done("interrupted");
      if (isRetryable(e) && retries < 3) {          // 瞬时错误: 退避重试, 不推进 turn 计数
        await new Promise((r) => setTimeout(r, 1000 * 2 ** retries++));
        continue;
      }
      return yield done("error_during_execution", String(e));
    }
    retries = 0;
    accumulate(usage, resp.usage);
    // 判断窗口要看「这一次请求有多大」, 不是累计量。命中缓存的部分也占窗口
    contextTokens = resp.usage.input_tokens + (resp.usage.cache_read_input_tokens ?? 0) +
                    (resp.usage.cache_creation_input_tokens ?? 0);

    /* ③ stop_reason 分支 */
    if (resp.stop_reason === "max_tokens") {
      // 被截断的消息可能带着半截 tool_use。整条丢掉 (不是挑拣), 加大上限重发
      if (budget >= 32_000) return yield done("error_during_execution", "单轮输出超过 32k 上限");
      budget = Math.min(budget * 2, 32_000);
      continue;
    }
    ctx.appendAssistant(resp.content);              // 原样整条进
    yield { type: "assistant", message: resp };
    if (resp.stop_reason === "refusal") return yield done("success", textOf(resp), "refusal");
    if (resp.stop_reason === "pause_turn") continue; // 服务端工具没跑完, 原样续上

    /* ④ 终止判定: 没有工具调用 */
    const calls = resp.content.filter((b) => b.type === "tool_use");
    if (calls.length === 0) return yield done("success", textOf(resp), resp.stop_reason);

    turns++;
    if (turns > opt.maxTurns) {
      ctx.appendSyntheticResults(calls.map((c) => c.id), "max turns reached");   // 先补齐 I1 再退出
      return yield done("error_max_turns");
    }
    if (usage.costUsd > opt.maxBudgetUsd) {
      ctx.appendSyntheticResults(calls.map((c) => c.id), "budget limit reached");
      return yield done("error_max_budget_usd");
    }

    /* ⑤ 执行 + 整批回传 */
    const outs = await executeBatch(calls, registry, gate, signal);
    const blocks: Anthropic.ToolResultBlockParam[] = outs.map((o) => ({
      type: "tool_result", tool_use_id: o.toolUseId, content: o.content, is_error: o.isError,
    }));
    // 中断位置 ②: 工具执行中途。abort 已让 run_bash 杀掉进程组, executeBatch 照样等长返回,
    // 所以先把这批结果整批回传、补齐配对, 再退出
    ctx.appendUser(blocks);
    yield { type: "user", content: blocks };
    if (signal.aborted) return yield done("interrupted");
    // 中断位置 ③: 两次 API 调用之间 —— 下一圈开头 stream 会立刻因 signal 抛错, 走 ①
  }
}

/** 触发压缩的阈值。调小它 (比如 COMPACT_AT=8000) 就能在短任务里看到压缩 */
const COMPACT_AT = Number(process.env.COMPACT_AT ?? 120_000);

async function summarize(c: Anthropic, model: string, msgs: readonly Anthropic.MessageParam[]): Promise<string> {
  const r = await c.messages.create({
    model, max_tokens: 2000,
    messages: [{ role: "user", content:
      "把下面这段 agent 会话压成一段摘要, 保留: 任务目标、读过/改过的文件、测试结果、已做的决定及理由、还没做完的事。\n\n" +
      JSON.stringify(msgs).slice(-100_000) }],
  });
  return textOf(r);
}

function textOf(m: Anthropic.Message): string {
  return m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}
function isRetryable(e: unknown): boolean {
  return e instanceof Anthropic.APIError && [429, 500, 502, 503, 529].includes(e.status ?? 0);
}
/** 粗略计价 (每百万 token: 输入 $3 / 缓存读 $0.3 / 缓存写 $3.75 / 输出 $15), 以官方价格页为准 */
function accumulate(u: UsageTotals, x: Anthropic.Usage): void {
  const read = x.cache_read_input_tokens ?? 0, write = x.cache_creation_input_tokens ?? 0;
  u.inputTokens += x.input_tokens; u.outputTokens += x.output_tokens;
  u.cacheReadTokens += read; u.cacheWriteTokens += write;
  u.costUsd += (x.input_tokens * 3 + read * 0.3 + write * 3.75 + x.output_tokens * 15) / 1e6;
}
