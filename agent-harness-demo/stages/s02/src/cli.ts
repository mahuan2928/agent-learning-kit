import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { ContextAssembler } from "./context.js";

const client = new Anthropic();
const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";

const tools: Anthropic.Tool[] = [{
  name: "read_file",
  description: "读取一个文本文件的内容。",
  input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
}];
const ctx = new ContextAssembler(tools);
ctx.appendUser(process.argv.slice(2).join(" "));

while (true) {
  const resp = await client.messages.create(ctx.assemble(model, 4096));   // assemble 内部先 validate
  ctx.appendAssistant(resp.content);

  const calls = resp.content.filter((b) => b.type === "tool_use");
  if (calls.length === 0) {
    console.log(resp.content.find((b) => b.type === "text")?.text);
    break;
  }

  ctx.appendUser(
    calls.map((c) => ({
      type: "tool_result" as const,
      tool_use_id: c.id,
      content: readFileSync((c.input as { path: string }).path, "utf8").slice(0, 4000),
    })),
  );
}
