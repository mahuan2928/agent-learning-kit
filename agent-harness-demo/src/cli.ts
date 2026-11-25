/**
 * Frontend —— 只渲染事件流, 不持有任何业务状态。对应文档 §1.3 / §7.1
 * 换成 Web / Slack 前端时, 这个文件是唯一要重写的。
 */
import Anthropic from "@anthropic-ai/sdk";
import { ContextAssembler, buildSystem } from "./context.js";
import { buildTools } from "./tools.js";
import { HookRunner } from "./hooks.js";
import { SessionStore } from "./session.js";
import { runLoop } from "./loop.js";

const task = process.argv.slice(2).join(" ");
if (!task) { console.error('用法: npm run agent -- "你的任务"'); process.exit(1); }

const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";
const store = new SessionStore(process.env.RESUME_SESSION);
const tools = buildTools(store);
const ctx = new ContextAssembler(buildSystem({ cwd: process.cwd(), model }), tools);
const ac = new AbortController();

// §2.4 「不打断、排队注入」优先于硬中断 —— 这里演示硬中断的安全退出
process.on("SIGINT", () => { console.log("\n[中断] 正在安全退出…"); ac.abort(); });

ctx.appendUser(task);
store.append({ kind: "user", payload: task });

let inTool = false;
for await (const ev of runLoop(new Anthropic(), ctx, tools, new HookRunner(), store, ac.signal,
                              { model, maxTokens: 8192, maxTurns: 30, maxBudgetUsd: 2 })) {
  switch (ev.type) {
    case "system":
      if (ev.subtype === "init") console.log(`[session ${store.id}]\n`);
      if (ev.subtype === "compact_boundary") console.log("\n[上下文已压缩]\n");
      break;

    case "stream_event": {
      const e = ev.event as any;
      // §7.1 三类必须处理的: 未知事件跳过 / 流中 error / thinking 空块
      if (e.type === "content_block_start" && e.content_block?.type === "tool_use") {
        inTool = true; process.stdout.write(`\n  ⚙ ${e.content_block.name} `);
      } else if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && !inTool) {
        process.stdout.write(e.delta.text);
      } else if (e.type === "content_block_stop" && inTool) {
        inTool = false; process.stdout.write("… ");
      } else if (e.type === "error") {
        console.error("\n[流中错误]", e.error?.type);   // HTTP 200 之后到达, 状态码表看不到
      }
      break;
    }

    case "user":
      for (const b of ev.content as any[]) {
        if (b.type === "tool_result") console.log(b.is_error ? `✗ ${String(b.content).split("\n")[0]}` : `✓`);
      }
      break;

    case "result": {
      const u = ev.usage;
      const hit = u.cacheReadTokens / Math.max(1, u.inputTokens + u.cacheReadTokens);
      console.log(`\n\n── ${ev.subtype} · ${ev.numTurns} turns ──`);
      console.log(`成本 $${u.costUsd.toFixed(4)} · 缓存命中 ${(hit * 100).toFixed(0)}%` +
                  ` (read ${u.cacheReadTokens} / write ${u.cacheWriteTokens})`);
      if (ev.subtype === "interrupted") {
        const r = store.rollbackAll();
        if (r.length) console.log(`已回滚 ${r.length} 个文件: ${r.join(", ")}`);
      }
      break;
    }
  }
}
