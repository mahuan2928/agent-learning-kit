/**
 * Core ↔ Frontend 的事件契约。  —— 对应文档 §1.6
 *
 * 这五类是 Core 对外吐出的【全部】东西。前端只订阅它们，
 * 永远拿不到 Core 的内部对象（尤其拿不到 messages 数组本身）。
 * 守住这条，将来把 Core 拆成独立进程就是纯机械改造。
 */
import type Anthropic from "@anthropic-ai/sdk";

export type AgentEvent =
  | { type: "system"; subtype: "init" | "compact_boundary" | "informational"; data: unknown }
  | { type: "assistant"; message: Anthropic.Message }
  | { type: "user"; content: Anthropic.ContentBlockParam[] }   // 工具结果走这里 (API 约定)
  | { type: "stream_event"; event: Anthropic.MessageStreamEvent }
  | { type: "result"; subtype: ResultSubtype; result?: string; usage: UsageTotals;
      numTurns: number; sessionId: string; stopReason: string | null };

/** 整个循环为什么结束 —— 注意这和 API 的 stop_reason 不是一回事, 见 §2.2 */
export type ResultSubtype =
  | "success"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_during_execution"
  | "interrupted";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;    // 健康的循环里这一项应该占输入的绝大多数 (§3.4)
  cacheWriteTokens: number;
  costUsd: number;
}

/** 工具定义。readOnly 决定它能否并发执行 —— 默认 false, 见 §2.5 */
export interface ToolDef<I = any> {
  name: string;
  description: string;        // 这里塞的是策略, 不只是参数说明 —— §4.1
  inputSchema: object;
  readOnly?: boolean;
  /** 副作用分类, 决定护栏形态 —— I3 */
  effect: "none" | "reversible" | "irreversible" | "external";
  run(input: I, signal: AbortSignal): Promise<string>;
}

export interface ToolOutcome {
  toolUseId: string;
  content: string;
  isError: boolean;
}
