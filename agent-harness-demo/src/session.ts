/**
 * Session Store —— 对应文档 §7.2
 *
 * 三个选择都是刻意的:
 *   1. JSONL 每行一条事件  → 追加 O(1), 崩在写一半只损失最后一行
 *   2. append-only        → 覆盖写快照做不出 resume / fork / rewind
 *   3. 纯文本             → 可以直接 grep / jq 排查
 *
 * 注意: 这里的 "append-only" 指【磁盘上的日志】,
 * 和 I4 那个 "messages 数组只追加" 是两回事, 别混。
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

const ROOT = ".agent/sessions";

export interface JournalLine {
  t: string;                       // ISO 时间戳
  kind: "user" | "assistant" | "tool_result" | "meta";
  payload: unknown;
}

export class SessionStore {
  readonly id: string;
  private readonly path: string;
  /** 编辑文件前的快照, 支持回滚 —— I3「可撤销」那一支 */
  private snapshots = new Map<string, string | null>();

  constructor(id?: string) {
    this.id = id ?? randomUUID();
    this.path = join(ROOT, `${this.id}.jsonl`);
    mkdirSync(dirname(this.path), { recursive: true });
  }

  append(line: Omit<JournalLine, "t">): void {
    // 单条事件保持小 —— 大 buffer 的 append 可能被拆成多次 write,
    // 真正的契约是「写小 + 读端容忍末行残缺」, 不是「原子」。
    appendFileSync(this.path, JSON.stringify({ t: new Date().toISOString(), ...line }) + "\n");
  }

  /**
   * resume: 继续往同一个文件追加。
   * 关键细节 —— kill -9 可能让最后一行只写了一半, 必须容忍并丢弃。
   */
  load(): JournalLine[] {
    if (!existsSync(this.path)) return [];
    const out: JournalLine[] = [];
    for (const raw of readFileSync(this.path, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      try { out.push(JSON.parse(raw)); }
      catch { console.error("[session] 丢弃残缺末行 (大概率是上次 kill -9)"); }
    }
    return out;
  }

  /** fork: 复制历史到新 id, 原会话不动 */
  fork(): SessionStore {
    const next = new SessionStore();
    if (existsSync(this.path)) copyFileSync(this.path, join(ROOT, `${next.id}.jsonl`));
    return next;
  }

  // ---- checkpoint: 与 git 正交的文件快照 (I3) ----
  snapshot(file: string): void {
    if (this.snapshots.has(file)) return;              // 只记第一次的原始态
    this.snapshots.set(file, existsSync(file) ? readFileSync(file, "utf8") : null);
  }

  rollbackAll(): string[] {
    const restored: string[] = [];
    for (const [file, before] of this.snapshots) {
      if (before === null) continue;                   // 原本不存在, 这里不做删除
      writeFileSync(file, before);
      restored.push(file);
    }
    this.snapshots.clear();
    return restored;
  }
}

/** 把 SDK 的 Message 落盘成一行 */
export function journalAssistant(store: SessionStore, m: Anthropic.Message): void {
  store.append({ kind: "assistant", payload: { id: m.id, stop_reason: m.stop_reason, content: m.content } });
}
