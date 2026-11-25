import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

const client = new Anthropic();
const model = process.env.AGENT_MODEL ?? "claude-sonnet-5-5";

const tools: Anthropic.Tool[] = [{
  name: "read_file",
  description: "读取一个文本文件的内容。",
  input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
}];
const messages: Anthropic.MessageParam[] = [
  { role: "user", content: process.argv.slice(2).join(" ") },
];

while (true) {
  const resp = await client.messages.create({ model, max_tokens: 4096, tools, messages });
  messages.push({ role: "assistant", content: resp.content });

  // 循环的全部分支逻辑, 就这一行: 这一轮有没有工具调用
  const calls = resp.content.filter((b) => b.type === "tool_use");
  if (calls.length === 0) {
    console.log(resp.content.find((b) => b.type === "text")?.text);
    break;
  }

  messages.push({
    role: "user",
    content: calls.map((c) => ({
      type: "tool_result" as const,
      tool_use_id: c.id,                 // 配对键 —— Stage 02 的主角
      content: readFileSync((c.input as { path: string }).path, "utf8").slice(0, 4000),
    })),
  });
}
