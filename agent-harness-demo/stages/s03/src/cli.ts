import Anthropic from "@anthropic-ai/sdk";
import { ContextAssembler } from "./context.js";
import { buildTools, toolError, isToolError } from "./tools.js";

const client = new Anthropic();
const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";

const tools = buildTools();
const registry = new Map(tools.map((t) => [t.name, t]));
const ctx = new ContextAssembler(tools);
ctx.appendUser(process.argv.slice(2).join(" "));

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
      out = tool ? await tool.run(c.input) : toolError("BAD_INPUT", `未知工具 ${c.name}`);
    } catch (e) {
      out = toolError("FAILED", String(e));
    }
    results.push({ type: "tool_result", tool_use_id: c.id, content: out, is_error: isToolError(out) });
  }
  ctx.appendUser(results);
}
