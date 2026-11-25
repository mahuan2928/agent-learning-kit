import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { ContextAssembler, buildSystem, reminder } from "./context.js";
import { buildTools } from "./tools.js";
import { SessionStore } from "./session.js";
import { runLoop } from "./loop.js";

/* 前端: 只渲染事件流, 不持有业务状态。换 Web / Slack 时只重写这个文件 */

const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";
// RESUME_SESSION=<id> 接着跑; 再加 FORK=1 则复制一份新会话, 原会话不动
const resumed = process.env.RESUME_SESSION ? new SessionStore(process.env.RESUME_SESSION) : undefined;
const store = resumed && process.env.FORK === "1" ? resumed.fork() : resumed ?? new SessionStore();
const tools = buildTools(store);
const ctx = new ContextAssembler(buildSystem({ cwd: process.cwd(), model }), tools, (e) => store.append(e));
const ac = new AbortController();

if (resumed) {
  ctx.restore(store.load());
  const fixed = ctx.repairOrphans();            // 崩在工具执行中途时, 末尾会有孤儿
  console.log(`[resume] 恢复 ${ctx.length} 条消息` + (fixed.length ? `, 补齐 ${fixed.length} 个孤儿 tool_use` : ""));
}

ctx.appendUser([
  { type: "text", text: process.argv.slice(2).join(" ") },
  reminder(`现在时间 ${new Date().toISOString()}`),
]);

// Ctrl+C 不再直接退出: 先 abort, 让循环停在合法状态。再按一次才强退
process.on("SIGINT", () => {
  if (ac.signal.aborted) process.exit(130);
  console.log("\n[中断] 正在安全退出… (再按一次强制退出)");
  ac.abort();
});

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => ac.abort());            // 提问时按 Ctrl+C 也走同一条路
  try { return (await rl.question(question, { signal: ac.signal })).trim().toLowerCase() === "y"; }
  catch { return false; }
  finally { rl.close(); }
}

let inTool = false;
for await (const ev of runLoop(new Anthropic(), ctx, tools, ac.signal,
  { model, maxTokens: 8192, maxTurns: 30, maxBudgetUsd: 2, sessionId: store.id, ask })) {
  switch (ev.type) {
    case "system":
      if (ev.subtype === "init") console.log(`[session ${store.id}]\n`);
      if (ev.subtype === "compact_boundary") console.log("\n[上下文已压缩]\n");
      break;

    case "stream_event": {
      const e = ev.event;
      if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
        inTool = true; process.stdout.write(`\n  ⚙ ${e.content_block.name} `);
      } else if (e.type === "content_block_delta" && e.delta.type === "text_delta" && !inTool) {
        process.stdout.write(e.delta.text);
      } else if (e.type === "content_block_stop" && inTool) {
        inTool = false; process.stdout.write("… ");
      }
      break;
    }

    case "assistant": {
      const u = ev.message.usage;
      console.log(`\n  [usage] read ${u.cache_read_input_tokens ?? 0} · write ${u.cache_creation_input_tokens ?? 0} · fresh ${u.input_tokens}`);
      break;
    }

    case "user":
      for (const b of ev.content) console.log(b.is_error ? `  ✗ ${String(b.content).split("\n")[0]}` : "  ✓");
      break;

    case "result": {
      const u = ev.usage;
      const hit = u.cacheReadTokens / Math.max(1, u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens);
      console.log(`\n── ${ev.subtype} · ${ev.numTurns} turns ──`);
      console.log(`成本 $${u.costUsd.toFixed(4)} · 缓存命中 ${(hit * 100).toFixed(0)}%`);
      if (ev.subtype === "interrupted") {
        const r = store.rollbackAll();
        if (r.length) console.log(`已回滚 ${r.length} 个文件: ${r.join(", ")}`);
        const orphans = ctx.validate();
        console.log(`I1 检查: ${orphans.length === 0 ? "通过" : `失败, 孤儿 ${orphans.join(", ")}`}`);
      }
      break;
    }
  }
}
