import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { ContextAssembler, buildSystem } from "../src/context.js";
import { buildTools } from "../src/tools.js";
import { SessionStore } from "../src/session.js";
import { HookRunner } from "../src/hooks.js";
import { runLoop } from "../src/loop.js";
import type { AgentEvent } from "../src/types.js";

/* 冻结的任务集 + 机械判分 + 每题 3 次取多数。用法: npm run eval */

type Check = { kind: "contains"; value: string } | { kind: "toolRoundsAtMost"; value: number };
interface Task { id: string; prompt: string; check: Check }

const tasks: Task[] = JSON.parse(readFileSync("evals/tasks.json", "utf8"));
const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";
const client = new Anthropic();
const RUNS = 3;

/** 跑一次: 和 cli.ts 装配方式完全相同, 只是不问人 (eval 里没人可问) */
async function runOnce(task: Task): Promise<{ pass: boolean; cost: number; sessionId: string }> {
  const store = new SessionStore();
  const tools = buildTools(store);
  const ctx = new ContextAssembler(buildSystem({ cwd: process.cwd(), model }), tools, (e) => store.append(e));
  ctx.appendUser(task.prompt);

  const events: AgentEvent[] = [];
  for await (const ev of runLoop(client, ctx, tools, new HookRunner(), new AbortController().signal, {
    model, maxTokens: 8192, maxTurns: 15, maxBudgetUsd: 0.5, sessionId: store.id,
    ask: async () => false,                       // 需要问人的操作在 eval 里一律拒绝
  })) events.push(ev);

  store.rollbackAll();                            // 评测不能留下副作用
  const result = events.find((e) => e.type === "result");
  return {
    pass: result?.subtype === "success" && score(task, events),
    cost: result?.type === "result" ? result.usage.costUsd : 0,
    sessionId: store.id,
  };
}

/** 判分先二分: 能机械判的绝不上 LLM judge —— 便宜、确定、可复现 */
function score(task: Task, events: AgentEvent[]): boolean {
  const text = events.map((e) => (e.type === "result" ? e.result ?? "" : "")).join("");
  const toolRounds = events.filter((e) => e.type === "user").length;   // 一轮 = 一批工具调用
  switch (task.check.kind) {
    case "contains":         return text.includes(task.check.value);
    case "toolRoundsAtMost": return toolRounds <= task.check.value;
  }
}

let passed = 0, totalCost = 0;
for (const task of tasks) {
  // 单次跑完就宣布「提升了 5 个点」, 那 5 个点很可能是噪声
  const runs = await Promise.all(Array.from({ length: RUNS }, () => runOnce(task)));
  const ok = runs.filter((r) => r.pass).length;
  const pass = ok * 2 > RUNS;
  const cost = runs.reduce((s, r) => s + r.cost, 0) / RUNS;
  passed += pass ? 1 : 0; totalCost += cost;
  const failed = runs.filter((r) => !r.pass).map((r) => r.sessionId.slice(0, 8));
  console.log(`${pass ? "PASS" : "FAIL"}  ${task.id.padEnd(16)} ${ok}/${RUNS}  $${cost.toFixed(3)}` +
              (failed.length ? `  失败会话: ${failed.join(" ")}` : ""));
}

// 两个数都要报。只看成功率, 你会为「多跑三轮、多读十个文件」换来的几个点沾沾自喜
console.log(`\n成功率 ${Math.round((passed / tasks.length) * 100)}% · 单任务 $${(totalCost / tasks.length).toFixed(3)}`);
