/**
 * Loop Driver —— turn 状态机。对应文档 §2.1~§2.6
 * 主路径只有 5 步, 其余全是异常路径。这个比例就是真实比例。
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, ResultSubtype, ToolDef, UsageTotals } from "./types.js";
import { ContextAssembler, reminder } from "./context.js";
import { executeBatch } from "./tools.js";
import { HookRunner } from "./hooks.js";
import { journalAssistant, type SessionStore } from "./session.js";

export interface LoopOptions {
  model: string; maxTokens: number; maxTurns: number; maxBudgetUsd: number;
}

export async function* runLoop(
  client: Anthropic, ctx: ContextAssembler, tools: ToolDef[],
  hooks: HookRunner, store: SessionStore, signal: AbortSignal, opt: LoopOptions,
): AsyncGenerator<AgentEvent> {
  const registry = new Map(tools.map((t) => [t.name, t]));
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  let turns = 0, compactions = 0;
  let budget = opt.maxTokens;

  yield { type: "system", subtype: "init", data: { sessionId: store.id, model: opt.model, tools: tools.map(t => t.name) } };

  const done = (subtype: ResultSubtype, result?: string, stopReason: string | null = null): AgentEvent =>
    ({ type: "result", subtype, result, usage, numTurns: turns, sessionId: store.id, stopReason });

  while (true) {
    /* ── ① 组装 (含压缩判定) ─────────────────────────────── */
    if (ctx.length > 0 && usage.inputTokens > 120_000) {
      if (++compactions > ContextAssembler.MAX_COMPACTIONS) {
        // thrashing 护栏: 压缩完立刻又满 → 停下来报错, 不要无限循环
        return yield done("error_during_execution", "压缩反复失败: 存在超大单体输入");
      }
      await ctx.simpleCompact(async (msgs) => summarize(client, opt.model, msgs));
      yield { type: "system", subtype: "compact_boundary", data: { compactions } };
    }
    const req = ctx.assemble(opt.model, budget);   // 内部会先跑 validate() (I1)

    /* ── ② 调模型 ────────────────────────────────────────── */
    let resp: Anthropic.Message;
    try {
      const stream = client.messages.stream(req as any, { signal });
      for await (const ev of stream) yield { type: "stream_event", event: ev };
      resp = await stream.finalMessage();
    } catch (e: any) {
      if (signal.aborted) {
        // §2.4①  整条 assistant 消息【不入历史】。
        // 挑完整 block 进去属于 partially drop → 400。
        // 什么都没 append, 所以没有孤儿要补, I1 天然成立。
        return yield done("interrupted");
      }
      if (isRetryable(e)) continue;                 // 瞬时错误: 重试但【不推进 turn 计数】
      return yield done("error_during_execution", String(e));
    }

    ctx.appendAssistant(resp.content);              // 原样整条进
    journalAssistant(store, resp);
    accumulate(usage, resp.usage);
    yield { type: "assistant", message: resp };

    /* ── ③ stop_reason 分支 (§2.2) ───────────────────────── */
    if (resp.stop_reason === "max_tokens") {
      budget = Math.min(budget * 2, 32_000);
      continue;                                     // 加大上限重发
    }
    if (resp.stop_reason === "refusal") return done("success", textOf(resp), "refusal") as any;
    if (resp.stop_reason === "pause_turn") continue; // 服务端工具未跑完, 原样回传继续

    /* ── ④ 终止判定 (§2.6: 几个条件同时成立) ──────────────── */
    const calls = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      const stop = await hooks.run("Stop", { session_id: store.id });
      if (stop.blocked) {                           // 模型想停, harness 不让
        ctx.appendUser(reminder(stop.additionalContext ?? "还不能结束, 请继续").text);
        continue;
      }
      return yield done("success", textOf(resp), resp.stop_reason);
    }

    turns++;
    if (turns > opt.maxTurns) {
      ctx.appendSyntheticResults(calls.map(c => c.id), "max turns reached");  // 先补齐 I1
      return yield done("error_max_turns", undefined, resp.stop_reason);
    }
    if (usage.costUsd > opt.maxBudgetUsd) {
      ctx.appendSyntheticResults(calls.map(c => c.id), "budget limit reached");
      return yield done("error_max_budget_usd", undefined, resp.stop_reason);
    }

    /* ── ⑤ 执行 + 整批回传 ───────────────────────────────── */
    const gate = async (name: string, input: any) => {
      const h = await hooks.run("PreToolUse", { tool_name: name, tool_input: input });
      if (h.blocked) return { allow: false, reason: h.permissionDecisionReason ?? "hook 阻断" };
      return { allow: true, input: h.updatedInput ?? input };
    };
    const outs = await executeBatch(
      calls.map(c => ({ id: c.id, name: c.name, input: c.input })), registry, gate, signal);

    if (signal.aborted) {
      // §2.4②  消息已经 append 了, 必须补齐配对才能安全退出
      ctx.appendSyntheticResults(calls.map(c => c.id), "cancelled by user");
      return yield done("interrupted");
    }

    const blocks: Anthropic.ContentBlockParam[] = outs.map(o => ({
      type: "tool_result", tool_use_id: o.toolUseId, content: o.content, is_error: o.isError,
    }));
    // tool_result 块排在最前, 文本块放后面 —— 而且必须在【同一条】消息里
    ctx.appendUser(blocks);
    store.append({ kind: "tool_result", payload: outs });
    yield { type: "user", content: blocks };
  }
}

function textOf(m: Anthropic.Message): string {
  return m.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
}
function isRetryable(e: any): boolean {
  return [429, 500, 502, 503, 529].includes(e?.status);
}
function accumulate(u: UsageTotals, x: Anthropic.Usage): void {
  u.inputTokens += x.input_tokens;
  u.outputTokens += x.output_tokens;
  u.cacheReadTokens += (x as any).cache_read_input_tokens ?? 0;
  u.cacheWriteTokens += (x as any).cache_creation_input_tokens ?? 0;
  // 粗略计价, 真实价格以 models 页为准
  u.costUsd += (x.input_tokens * 3 + u.cacheReadTokens * 0.3 + x.output_tokens * 15) / 1e6;
}
async function summarize(c: Anthropic, model: string, msgs: readonly Anthropic.MessageParam[]): Promise<string> {
  const r = await c.messages.create({
    model, max_tokens: 2000,
    messages: [{ role: "user", content:
      `把下面这段 agent 会话压成一段摘要, 保留: 任务目标、已读过/改过的文件、测试结果、已做的决定及理由。\n\n` +
      JSON.stringify(msgs).slice(0, 100_000) }],
  });
  return r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
}
