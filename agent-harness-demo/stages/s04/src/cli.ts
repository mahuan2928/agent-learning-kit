import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { ContextAssembler } from "./context.js";
import { buildTools, toolError, isToolError } from "./tools.js";
import { SessionStore } from "./session.js";
import type { ToolDef } from "./types.js";

const client = new Anthropic();
const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";

const store = new SessionStore();
const tools = buildTools(store);
const registry = new Map(tools.map((t) => [t.name, t]));
const ctx = new ContextAssembler(tools);
ctx.appendUser(process.argv.slice(2).join(" "));

// Ctrl+C: 把这次会话改过的文件全部还原, 再退出
process.on("SIGINT", () => {
  const r = store.rollbackAll();
  console.log(`\n[中断] 已回滚 ${r.length} 个文件 ${r.join(", ")}`);
  process.exit(130);
});

/** 权限门: 能快照的放行, 不能快照的问人。AGENT_YES=1 时全部放行 (给 eval 用) */
async function gate(tool: ToolDef, input: unknown): Promise<boolean> {
  if (tool.effect === "none" || tool.effect === "reversible") return true;
  if (process.env.AGENT_YES === "1") return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`  ⚠ 允许 ${tool.name} ${JSON.stringify(input)} ? [y/N] `);
  rl.close();
  return ans.trim().toLowerCase() === "y";
}

while (true) {
  const resp = await client.messages.create(ctx.assemble(model, 4096));
  ctx.appendAssistant(resp.content);

  const calls = resp.content.filter((b) => b.type === "tool_use");
  if (calls.length === 0) {
    console.log(resp.content.find((b) => b.type === "text")?.text);
    break;
  }

  // 逐个执行。工具抛异常也要变成一条 tool_result —— 少一条就是孤儿 (I1)
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const c of calls) {
    console.log(`  ⚙ ${c.name} ${JSON.stringify(c.input)}`);
    const tool = registry.get(c.name);
    let out: string;
    try {
      if (!tool) out = toolError("BAD_INPUT", `未知工具 ${c.name}`);
      else if (!(await gate(tool, c.input)))
        out = toolError("DENIED", "用户拒绝了这次调用", "换一种不需要这个操作的做法, 或直接问用户");
      else out = await tool.run(c.input);
    } catch (e) {
      out = toolError("FAILED", String(e));
    }
    results.push({ type: "tool_result", tool_use_id: c.id, content: out, is_error: isToolError(out) });
  }
  ctx.appendUser(results);
}
