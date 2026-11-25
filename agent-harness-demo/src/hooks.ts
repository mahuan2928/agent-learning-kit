/**
 * Hook Runner —— 对应文档 §1.5
 * 唯一能做到「100% 发生」的地方。跑在独立子进程, 不占 context window。
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop";

export interface HookOutput {
  permissionDecision?: "allow" | "deny";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;   // hook 独有: 改写工具入参
  additionalContext?: string;               // hook 向模型说话的唯一通道
}

interface HookConfig { hooks: Record<string, { matcher?: string; command: string }[]> }

export class HookRunner {
  private cfg: HookConfig = { hooks: {} };
  constructor(path = ".agent/settings.json") {
    if (existsSync(path)) this.cfg = JSON.parse(readFileSync(path, "utf8"));
  }

  async run(event: HookEvent, payload: Record<string, unknown>): Promise<HookOutput & { blocked: boolean }> {
    const entries = (this.cfg.hooks?.[event] ?? [])
      .filter((h) => !h.matcher || h.matcher === payload.tool_name);
    for (const h of entries) {
      const r = await this.spawn(h.command, { hook_event_name: event, ...payload });
      // 退出码 2 = 阻断。注意 hook 的 allow 只是「不反对」, 不跳过后续 deny/ask 规则。
      if (r.code === 2) return { ...r.out, blocked: true };
      if (r.out.updatedInput || r.out.additionalContext) return { ...r.out, blocked: false };
    }
    return { blocked: false };
  }

  private spawn(cmd: string, stdin: unknown) {
    return new Promise<{ code: number; out: HookOutput }>((res) => {
      const child = execFile("/bin/bash", ["-c", cmd], { timeout: 10_000 }, (err, stdout) => {
        let out: HookOutput = {};
        try { out = JSON.parse(stdout).hookSpecificOutput ?? {}; } catch { /* 非 JSON 输出忽略 */ }
        res({ code: (err as any)?.code ?? 0, out });
      });
      child.stdin?.end(JSON.stringify(stdin));
    });
  }
}
