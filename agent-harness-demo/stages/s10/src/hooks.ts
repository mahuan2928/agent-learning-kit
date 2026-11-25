import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Hook runner: 唯一能做到「100% 发生」的地方。
 * 每个 hook 是独立子进程, 收 JSON (stdin), 回 JSON (stdout), 不占 context window。
 */
export type HookEvent = "PreToolUse" | "Stop";

export interface HookOutput {
  permissionDecision?: "allow" | "deny";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;   // hook 独有: 改写工具入参
  additionalContext?: string;               // hook 向模型说话的通道
}

interface HookConfig { hooks?: Partial<Record<HookEvent, { matcher?: string; command: string }[]>> }

export class HookRunner {
  private cfg: HookConfig = {};

  constructor(path = ".agent/settings.json") {
    if (existsSync(path)) this.cfg = JSON.parse(readFileSync(path, "utf8"));
  }

  async run(event: HookEvent, payload: Record<string, unknown>): Promise<HookOutput & { blocked: boolean }> {
    const entries = (this.cfg.hooks?.[event] ?? [])
      .filter((h) => !h.matcher || h.matcher === payload.tool_name);
    let input = payload.tool_input;
    let merged: HookOutput = {};
    for (const h of entries) {
      const r = await this.spawn(h.command, { hook_event_name: event, ...payload, tool_input: input });
      if (r.code === 2) return { ...r.out, blocked: true };      // 退出码 2 = 阻断, 后面的 hook 不再跑
      if (r.code !== 0) console.error(`[hook] ${h.command} 退出码 ${r.code}, 已忽略 (忘了 chmod +x?)`);
      if (r.out.updatedInput) input = { ...(input as object), ...r.out.updatedInput };  // 下一个 hook 看到改写后的入参
      merged = { ...merged, ...r.out };
    }
    return { ...merged, updatedInput: input as Record<string, unknown> | undefined, blocked: false };
  }

  private spawn(cmd: string, stdin: unknown) {
    return new Promise<{ code: number; out: HookOutput }>((res) => {
      const child = execFile("/bin/bash", ["-c", cmd], { timeout: 60_000 }, (err, stdout) => {
        let out: HookOutput = {};
        try { out = JSON.parse(stdout).hookSpecificOutput ?? {}; } catch { /* 非 JSON 输出忽略 */ }
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        res({ code, out });
      });
      child.stdin?.end(JSON.stringify(stdin));
    });
  }
}
