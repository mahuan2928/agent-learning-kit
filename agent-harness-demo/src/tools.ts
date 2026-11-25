/**
 * Tool Layer —— 对应文档 §4.1~§4.6 / §2.5 / I3
 * 铁律: 只返回 tool_result, 绝不回调 Core。想影响模型走 hook 的 additionalContext。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve, relative, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolDef, ToolOutcome } from "./types.js";
import type { SessionStore } from "./session.js";

/* ── §4.4 结果整形: 把「截断」从压缩问题变成寻址问题 ───────────── */
const INLINE_LIMIT = 30_000;             // 字符; 超了落盘
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

/* ── §4.5 错误反馈: 让模型别打转 ──────────────────────────────── */
export function toolError(kind: "DENIED" | "NOT_FOUND" | "TIMEOUT" | "BAD_INPUT" | "FAILED",
                          msg: string, hint?: string): string {
  // 关键是第二句: 显式说明这是不是终局性失败。
  // 「模型换着花样反复试同一个被禁操作」是最常见的 token 黑洞,
  // 根因几乎总是错误消息没说清「重试不会成功」。
  const terminal = kind === "DENIED" || kind === "NOT_FOUND" || kind === "BAD_INPUT";
  return `${kind}: ${msg}\n${terminal ? "重试不会成功。" : "这是瞬时失败, 可以重试。"}` +
         (hint ? `\n${hint}` : "");
}

/* ── 工具实现 ─────────────────────────────────────────────────── */
const WORKSPACE = resolve(process.cwd());
function insideWorkspace(p: string): boolean {
  const r = relative(WORKSPACE, resolve(p));
  return !!r && !r.startsWith("..") && !resolve(p).startsWith("/etc");
}

export function buildTools(store: SessionStore): ToolDef[] {
  return [
    {
      name: "read_file",
      description:
        "读取一个文本文件的内容。\n" +
        "- 刚用 write_file 改过的文件不需要再读一遍确认, harness 会跟踪文件状态。\n" +   // §4.1 反模式纠正
        "- 大文件会自动落盘并返回路径, 按需分段读回。",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      readOnly: true,                      // §2.5 → 可并发
      effect: "none",
      async run({ path }: { path: string }) {
        if (!insideWorkspace(path)) return toolError("DENIED", `${path} 在工作目录之外`, `可读范围: ${WORKSPACE}`);
        if (!existsSync(path)) return toolError("NOT_FOUND", `${path} 不存在`);
        return shapeResult("read_file", path, readFileSync(path, "utf8"));
      },
    },
    {
      name: "write_file",
      description: "写入文件 (覆盖)。写入前 harness 会自动快照原内容, 可回滚。",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      readOnly: false,                     // §2.5 → 必须串行
      effect: "reversible",                // I3: 可撤销 → 用快照兜底
      async run({ path, content }: { path: string; content: string }) {
        if (!insideWorkspace(path)) return toolError("DENIED", `${path} 在工作目录之外`, `可写范围: ${WORKSPACE}`);
        store.snapshot(path);              // I3: 改之前先存快照
        writeFileSync(path, content);
        return `已写入 ${path} (${content.length} 字符)`;
      },
    },
    {
      name: "run_bash",
      description: "执行一条 shell 命令。\n- 不支持交互式命令。\n- 超过 30 秒会被终止。",
      inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      readOnly: false,
      effect: "irreversible",              // I3: 不可撤销 → 必须靠权限门
      run: runBash,
    },
  ];
}

/**
 * §4.6 + Ch8 M2: 超时要杀【进程组】并关掉管道。
 * 只 kill 直接子进程的话, 子孙进程继承了 stdout, 读端永远不返回 ——
 * 这正是「npm run dev 挂死整个 agent」的真正成因。
 */
function runBash({ command }: { command: string }, signal: AbortSignal): Promise<string> {
  return new Promise((res) => {
    const child = execFile("/bin/bash", ["-c", command], {
      timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },   // §4.6 剥离环境变量
    }, (err, stdout, stderr) => {
      if (err && (err as any).killed) return res(toolError("TIMEOUT", "命令超过 30 秒被终止"));
      const out = (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "");
      res(err ? toolError("FAILED", `退出码 ${(err as any).code}`, out.slice(0, 2000))
              : shapeResult("run_bash", command, out || "(无输出)"));
    });
    const kill = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    signal.addEventListener("abort", kill, { once: true });
  });
}

/* ── §2.5 并发调度: 按工具自己的声明分组 ────────────────────────── */
export async function executeBatch(
  calls: { id: string; name: string; input: any }[],
  registry: Map<string, ToolDef>,
  gate: (name: string, input: any) => Promise<{ allow: boolean; reason?: string; input?: any }>,
  signal: AbortSignal,
): Promise<ToolOutcome[]> {
  // ⚠️ 永远返回等长数组 —— 这是 I1 的机械保证, 异常在内部转成 error result
  const results = new Array<ToolOutcome>(calls.length);

  const runOne = async (i: number) => {
    const c = calls[i]!;
    const tool = registry.get(c.name);
    if (!tool) { results[i] = { toolUseId: c.id, content: toolError("BAD_INPUT", `未知工具 ${c.name}`), isError: true }; return; }

    const decision = await gate(c.name, c.input);          // §4.3 权限流水线
    if (!decision.allow) { results[i] = { toolUseId: c.id, content: toolError("DENIED", decision.reason ?? "被拒绝"), isError: true }; return; }

    try {
      const out = await tool.run(decision.input ?? c.input, signal);
      results[i] = { toolUseId: c.id, content: out, isError: out.startsWith("DENIED:") || out.startsWith("FAILED:") };
    } catch (e) {
      results[i] = { toolUseId: c.id, content: toolError("FAILED", String(e)), isError: true };
    }
  };

  const idx = calls.map((_, i) => i);
  const parallel = idx.filter((i) => registry.get(calls[i]!.name)?.readOnly === true);
  const serial = idx.filter((i) => !parallel.includes(i));

  await Promise.all(parallel.map(runOne));   // 只读 → 并发
  for (const i of serial) await runOne(i);   // 改状态 → 串行, 防写冲突

  return results;
}
