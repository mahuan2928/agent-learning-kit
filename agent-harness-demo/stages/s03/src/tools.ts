import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolDef } from "./types.js";

/* ── 大结果落盘: 把「截断」从压缩问题变成寻址问题 ───────────── */
const INLINE_LIMIT = 30_000;
const SPILL_DIR = ".agent/spill";

export function shapeResult(toolName: string, args: string, raw: string): string {
  if (raw.length <= INLINE_LIMIT) return raw;
  mkdirSync(SPILL_DIR, { recursive: true });
  const file = join(SPILL_DIR, `${toolName}-${randomUUID().slice(0, 8)}.txt`);
  writeFileSync(file, raw);
  // 路径 + 原大小 + 开头摘录。三样齐全, 模型才能自己判断值不值得读回去。
  return `输出过大已落盘 (${raw.length} 字符)。\n路径: ${file}\n工具: ${toolName} ${args}\n` +
         `--- 开头 2000 字符 ---\n${raw.slice(0, 2000)}`;
}

/* ── 错误消息: 第二句说清「重试有没有用」 ─────────────────────── */
type ErrorKind = "DENIED" | "NOT_FOUND" | "TIMEOUT" | "BAD_INPUT" | "FAILED";

export function toolError(kind: ErrorKind, msg: string, hint?: string): string {
  const advice =
    kind === "TIMEOUT" ? "这是瞬时失败, 可以重试。" :
    kind === "FAILED"  ? "先看输出, 修正后再试。" :
                         "重试不会成功。";            // DENIED / NOT_FOUND / BAD_INPUT
  return `${kind}: ${msg}\n${advice}` + (hint ? `\n${hint}` : "");
}

export const isToolError = (out: string) => /^(DENIED|NOT_FOUND|TIMEOUT|BAD_INPUT|FAILED):/.test(out);

/* ── 工具注册表: 新工具只在这里加, cli.ts 不用改 ─────────────── */
export function buildTools(): ToolDef[] {
  return [
    {
      name: "read_file",
      description: "读取一个文本文件的内容。\n- 大文件会自动落盘并返回路径和开头摘录。",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      async run({ path }: { path: string }) {
        if (!existsSync(path)) return toolError("NOT_FOUND", `${path} 不存在`);
        return shapeResult("read_file", path, readFileSync(path, "utf8"));
      },
    },
  ];
}
