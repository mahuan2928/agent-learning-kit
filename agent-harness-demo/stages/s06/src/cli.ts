import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { ContextAssembler, buildSystem, reminder } from "./context.js";
import { buildTools, executeBatch } from "./tools.js";
import { SessionStore } from "./session.js";
import type { Gate, UsageTotals } from "./types.js";

const client = new Anthropic();
const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";

const store = new SessionStore();
const tools = buildTools(store);
const registry = new Map(tools.map((t) => [t.name, t]));
const ctx = new ContextAssembler(buildSystem({ cwd: process.cwd(), model }), tools);
const ac = new AbortController();          // 现在只用来传给工具; Stage 07 才接上 Ctrl+C
const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

// 逐轮变化的信息 (时间) 走消息里的 reminder, 不进 system
ctx.appendUser([
  { type: "text", text: process.argv.slice(2).join(" ") },
  reminder(`现在时间 ${new Date().toISOString()}`),
]);

// Ctrl+C: 把这次会话改过的文件全部还原, 再退出
process.on("SIGINT", () => {
  const r = store.rollbackAll();
  console.log(`\n[中断] 已回滚 ${r.length} 个文件 ${r.join(", ")}`);
  process.exit(130);
});

/** 权限门: 能快照的放行, 不能快照的问人。AGENT_YES=1 时全部放行 (给 eval 用) */
const gate: Gate = async (tool, input) => {
  if (tool.effect === "none" || tool.effect === "reversible") return { allow: true, input };
  if (process.env.AGENT_YES === "1") return { allow: true, input };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`  ⚠ 允许 ${tool.name} ${JSON.stringify(input)} ? [y/N] `);
  rl.close();
  return ans.trim().toLowerCase() === "y" ? { allow: true, input } : { allow: false, reason: "用户拒绝了这次调用" };
};

/** 粗略计价 (每百万 token: 输入 $3 / 缓存读 $0.3 / 缓存写 $3.75 / 输出 $15), 以官方价格页为准 */
function accumulate(u: UsageTotals, x: Anthropic.Usage): void {
  const read = x.cache_read_input_tokens ?? 0, write = x.cache_creation_input_tokens ?? 0;
  u.inputTokens += x.input_tokens; u.outputTokens += x.output_tokens;
  u.cacheReadTokens += read; u.cacheWriteTokens += write;
  u.costUsd += (x.input_tokens * 3 + read * 0.3 + write * 3.75 + x.output_tokens * 15) / 1e6;
}

while (true) {
  const resp = await client.messages.create(ctx.assemble(model, 4096));
  ctx.appendAssistant(resp.content);
  accumulate(usage, resp.usage);
  const r = resp.usage;
  console.log(`  [usage] read ${r.cache_read_input_tokens ?? 0} · write ${r.cache_creation_input_tokens ?? 0} · fresh ${r.input_tokens}`);

  const calls = resp.content.filter((b) => b.type === "tool_use");
  if (calls.length === 0) {
    console.log(resp.content.find((b) => b.type === "text")?.text);
    break;
  }

  const outs = await executeBatch(calls, registry, gate, ac.signal,
    (c) => console.log(`  ⚙ ${c.name} ${JSON.stringify(c.input)}`));

  ctx.appendUser(outs.map((o) => ({
    type: "tool_result" as const, tool_use_id: o.toolUseId, content: o.content, is_error: o.isError,
  })));
}

const hit = usage.cacheReadTokens / Math.max(1, usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens);
console.log(`\n成本 $${usage.costUsd.toFixed(4)} · 缓存命中 ${(hit * 100).toFixed(0)}%`);
