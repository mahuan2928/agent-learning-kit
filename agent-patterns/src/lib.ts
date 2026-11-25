/**
 * 六个模式共用的底座: 两种调用 (文本 / 结构化) + 一个极简工具循环 + 调用追踪。
 *
 * 设计取舍:
 *  - 所有调用都走 trace。设计模式的好坏最后落在「每一步花了多少 token、多久、谁做的」,
 *    看不到这张表就没法比较两种模式。
 *  - 结构化输出用 output_config.format (zod), 不用「强制调用某个工具」拿 JSON ——
 *    Opus 5.5 / Sonnet 5.5 上 tool_choice any/tool 会直接 400。
 *  - toolLoop 是 agent-harness-demo Stage 01+03 的浓缩版, 只够演示用。
 *    生产里请换成 stages/s11 的 runLoop (I1 守护、缓存、中断、压缩、hooks 都在那里)。
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

type Beta = Anthropic.Beta.Messages.BetaMessage;
type BetaParam = Anthropic.Beta.Messages.BetaMessageParam;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** 主模型 (编排、生成、裁判)。环境变量可覆盖 */
export const MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";
/** 便宜快速的模型 (路由、批量 worker、投票) */
export const FAST = process.env.AGENT_FAST_MODEL ?? "claude-haiku-5-5";

export const client = new Anthropic();

/* ── 追踪: 每次调用一行 ───────────────────────────────────────── */
const PRICE: Record<string, [number, number]> = {        // $/百万 token [输入, 输出], 以官方价格页为准
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
};
export interface TraceRow { step: string; model: string; inTok: number; outTok: number; ms: number; usd: number }
export const trace: TraceRow[] = [];

function record(step: string, r: Beta, t0: number): void {
  const [pi, po] = PRICE[r.model] ?? [0, 0];
  const inTok = r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0);
  trace.push({ step, model: r.model, inTok, outTok: r.usage.output_tokens, ms: Date.now() - t0,
               usd: (inTok * pi + r.usage.output_tokens * po) / 1e6 });
}

export function printTrace(): void {
  console.log("\n── trace ─────────────────────────────────────────────");
  for (const t of trace)
    console.log(`${t.step.padEnd(26)} ${t.model.padEnd(18)} in ${String(t.inTok).padStart(6)}  out ${String(t.outTok).padStart(5)}  ${String(t.ms).padStart(6)}ms  $${t.usd.toFixed(4)}`);
  const usd = trace.reduce((s, t) => s + t.usd, 0);
  console.log(`合计 ${trace.length} 次调用 · $${usd.toFixed(4)}`);
}

/* ── 两种调用 ─────────────────────────────────────────────────── */
export interface CallOpts { step: string; model?: string; system?: string; effort?: Effort; maxTokens?: number }

export class RefusalError extends Error {}

/** 主模型请求默认带服务端 fallback: 安全分类器误拒时由 API 自动换模型重跑。Haiku 5.5 不支持, 不带 */
function base(o: CallOpts) {
  const model = o.model ?? MODEL;
  return {
    model,
    max_tokens: o.maxTokens ?? 16000,
    ...(o.system ? { system: o.system } : {}),
    ...(model === FAST ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
  };
}

function guard(r: Beta, step: string): void {
  if (r.stop_reason === "refusal") throw new RefusalError(`${step}: 模型拒绝 (${r.stop_details?.category ?? "unknown"})`);
  if (r.stop_reason === "max_tokens") throw new Error(`${step}: 输出被 max_tokens 截断`);
}

const asMessages = (p: string | BetaParam[]): BetaParam[] => (typeof p === "string" ? [{ role: "user", content: p }] : p);
export const textOf = (r: Beta) => r.content.filter((b) => b.type === "text").map((b) => b.text).join("");

/** 普通文本调用 */
export async function ask(prompt: string | BetaParam[], o: CallOpts): Promise<string> {
  const t0 = Date.now();
  const r = await client.beta.messages.create({
    ...base(o), messages: asMessages(prompt), output_config: { effort: o.effort ?? "medium" },
  });
  record(o.step, r, t0);
  guard(r, o.step);
  return textOf(r);
}

/** 结构化调用: 返回值已经按 zod schema 校验过 */
export async function askJSON<S extends z.ZodType>(schema: S, prompt: string | BetaParam[], o: CallOpts): Promise<z.infer<S>> {
  const t0 = Date.now();
  const r = await client.beta.messages.parse({
    ...base(o), messages: asMessages(prompt),
    output_config: { effort: o.effort ?? "medium", format: betaZodOutputFormat(schema) },
  });
  record(o.step, r, t0);
  guard(r, o.step);
  if (r.parsed_output == null) throw new Error(`${o.step}: 结构化输出解析失败`);
  return r.parsed_output as z.infer<S>;
}

/* ── 极简工具循环 (worker 和 RAG 用) ─────────────────────────────── */
export interface Tool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: false };
  run(input: any): Promise<string> | string;
}

export async function toolLoop(task: string, tools: Tool[], o: CallOpts & { maxTurns?: number })
  : Promise<{ text: string; turns: number; toolCalls: { name: string; input: unknown }[] }> {
  const messages: BetaParam[] = [{ role: "user", content: task }];
  const registry = new Map(tools.map((t) => [t.name, t]));
  const toolCalls: { name: string; input: unknown }[] = [];
  const maxTurns = o.maxTurns ?? 6;

  for (let turn = 1; ; turn++) {
    const t0 = Date.now();
    const r = await client.beta.messages.create({
      ...base(o), messages, output_config: { effort: o.effort ?? "medium" },
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    });
    record(`${o.step}#${turn}`, r, t0);
    guard(r, o.step);
    messages.push({ role: "assistant", content: r.content });            // 原样整条进 (含 thinking)

    const calls = r.content.filter((b) => b.type === "tool_use");
    if (calls.length === 0) return { text: textOf(r), turns: turn, toolCalls };
    if (turn >= maxTurns) throw new Error(`${o.step}: 超过 ${maxTurns} 轮仍未结束`);

    const results = await Promise.all(calls.map(async (c) => {           // 每个 tool_use 都配一个结果 (I1)
      toolCalls.push({ name: c.name, input: c.input });
      const tool = registry.get(c.name);
      let content: string, is_error = false;
      try { content = tool ? String(await tool.run(c.input)) : `BAD_INPUT: 未知工具 ${c.name}`; }
      catch (e) { content = `FAILED: ${String(e)}`; is_error = true; }
      return { type: "tool_result" as const, tool_use_id: c.id, content, is_error };
    }));
    messages.push({ role: "user", content: results });
  }
}

/** 并发上限: 一次最多跑 n 个, 防止 fan-out 打爆速率限制 */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

export { BANNED_TERMS, bannedTermsIn } from "./rules.js";
