import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolDef, ToolCall, ToolOutcome, Gate } from "./types.js";
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
      readOnly: true,                      // 只读 → 可并发
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
      description: "在工作目录执行一条 shell 命令。不支持交互式命令。超过 30 秒会被终止。",
      inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      effect: "irreversible",              // 不可撤销 → 执行前必须过权限门
      run: runBash,
    },
  ];
}

/* ── run_bash: 超时要杀【进程组】 ────────────────────────────── */
const BASH_TIMEOUT_MS = Number(process.env.BASH_TIMEOUT_MS ?? 30_000);

function runBash({ command }: { command: string }, signal: AbortSignal): Promise<string> {
  return new Promise((res) => {
    const child = spawn("/bin/bash", ["-c", command], {
      detached: true,                      // 自成一个进程组 (pgid = child.pid), 才能整组杀
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME },   // 剥离环境变量, API key 不外泄
    });
    let out = "", timedOut = false;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    // ⚠️ 只 kill 直接子进程不够: 子孙进程继承了 stdout, 管道不关, close 永远不来。
    //    这才是「npm run dev 挂死整个 agent」的真正成因。负 pid = 整个进程组。
    const killTree = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* 已经退出 */ } };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, BASH_TIMEOUT_MS);
    signal.addEventListener("abort", killTree, { once: true });

    child.on("error", (e) => { clearTimeout(timer); res(toolError("FAILED", String(e))); });
    child.on("close", (code) => {             // 进程退出 + 管道全部关闭之后才触发
      clearTimeout(timer);
      signal.removeEventListener("abort", killTree);
      if (timedOut) return res(toolError("TIMEOUT", `命令超过 ${BASH_TIMEOUT_MS / 1000} 秒, 已终止整个进程组`));
      if (signal.aborted) return res(toolError("FAILED", "被用户中断"));
      if (code !== 0) return res(toolError("FAILED", `退出码 ${code}`, out.slice(-2000)));
      res(shapeResult("run_bash", command, out || "(无输出)"));
    });
  });
}

/* ── 批量执行: 按工具自己声明的 readOnly 分组 ─────────────────── */
export async function executeBatch(
  calls: ToolCall[],
  registry: Map<string, ToolDef>,
  gate: Gate,
  signal: AbortSignal,
  onStart: (c: ToolCall) => void = () => {},
): Promise<ToolOutcome[]> {
  // 永远返回和 calls 等长的数组 —— I1 的机械保证。任何异常都在内部变成 error result
  const results = new Array<ToolOutcome>(calls.length);

  const runOne = async (i: number) => {
    const c = calls[i]!;
    const done = (content: string) => (results[i] = { toolUseId: c.id, content, isError: isToolError(content) });
    const tool = registry.get(c.name);
    if (!tool) return done(toolError("BAD_INPUT", `未知工具 ${c.name}`));
    try {
      const d = await gate(tool, c.input);
      if (!d.allow) return done(toolError("DENIED", d.reason, "换一种不需要这个操作的做法, 或直接问用户"));
      onStart(c);
      done(await tool.run(d.input, signal));
    } catch (e) {
      done(toolError("FAILED", String(e)));
    }
  };

  const idx = calls.map((_, i) => i);
  const parallel = idx.filter((i) => registry.get(calls[i]!.name)?.readOnly === true);
  const serial = idx.filter((i) => !parallel.includes(i));

  await Promise.all(parallel.map(runOne));   // 只读 → 并发
  for (const i of serial) await runOne(i);   // 改状态 → 串行, 防写冲突
  return results;
}
