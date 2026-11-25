import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolDef } from "./types.js";
import type { SessionStore } from "./session.js";

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

/* ── 工作目录白名单: 成本最低、也最不能省的一道 ──────────────── */
const WORKSPACE = resolve(process.cwd());
function insideWorkspace(p: string): boolean {
  const r = relative(WORKSPACE, resolve(p));
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
}

/* ── 工具注册表: 新工具只在这里加, cli.ts 不用改 ─────────────── */
export function buildTools(store: SessionStore): ToolDef[] {
  return [
    {
      name: "read_file",
      description:
        "读取一个文本文件的内容。\n" +
        "- 大文件会自动落盘并返回路径和开头摘录。\n" +
        "- 刚用 write_file 写过的文件不需要再读一遍确认。",   // 日志里观察到的坏习惯, 直接写进描述
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      effect: "none",
      async run({ path }: { path: string }) {
        if (!insideWorkspace(path)) return toolError("DENIED", `${path} 在工作目录之外`, `可读范围: ${WORKSPACE}`);
        if (!existsSync(path)) return toolError("NOT_FOUND", `${path} 不存在`);
        return shapeResult("read_file", path, readFileSync(path, "utf8"));
      },
    },
    {
      name: "write_file",
      description: "写入文件 (整体覆盖)。写入前会自动快照原内容, 出错可回滚。",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      effect: "reversible",                // 可撤销 → 用快照兜底, 不用问人
      async run({ path, content }: { path: string; content: string }) {
        if (!insideWorkspace(path)) return toolError("DENIED", `${path} 在工作目录之外`, `可写范围: ${WORKSPACE}`);
        store.snapshot(path);              // 第一行就是快照
        writeFileSync(path, content);
        return `已写入 ${path} (${content.length} 字符)`;
      },
    },
    {
      name: "run_bash",
      description: "在工作目录执行一条 shell 命令。不支持交互式命令。",
      inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      effect: "irreversible",              // 不可撤销 → 执行前必须过权限门
      run: runBash,
    },
  ];
}

/** 最朴素的版本: 没有超时。Stage 05 会把它换掉 */
function runBash({ command }: { command: string }): Promise<string> {
  return new Promise((res) => {
    execFile("/bin/bash", ["-c", command], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
      res(err ? toolError("FAILED", `退出码 ${err.code}`, out.slice(-2000))
              : shapeResult("run_bash", command, out || "(无输出)"));
    });
  });
}
