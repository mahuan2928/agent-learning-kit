import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { JournalEntry } from "./context.js";

const ROOT = ".agent/sessions";

/**
 * 一次会话的状态: 文件快照 (Stage 04) + JSONL 日志 (本阶段)。
 *
 * 日志的三个选择都是刻意的:
 *   按行存   → 追加 O(1), 崩在写一半只损失最后一行
 *   只追加   → 覆盖写快照做不出 resume / fork
 *   纯文本   → 能直接 grep / jq 排查
 */
export class SessionStore {
  readonly id: string;
  readonly path: string;
  private snapshots = new Map<string, string | null>();

  constructor(id?: string) {
    this.id = id ?? randomUUID();
    this.path = join(ROOT, `${this.id}.jsonl`);
    mkdirSync(ROOT, { recursive: true });
  }

  /** 交给 ContextAssembler 的 journal 回调。一条消息一行 */
  append(entry: JournalEntry): void {
    appendFileSync(this.path, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
  }

  load(): JournalEntry[] {
    if (!existsSync(this.path)) return [];
    const out: JournalEntry[] = [];
    for (const raw of readFileSync(this.path, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      try { out.push(JSON.parse(raw)); }
      catch { console.error("[session] 丢弃残缺末行 (大概率是上次 kill -9)"); }
      //     ↑ 这一行不能省。崩溃时最后一行很可能是半截的。
    }
    return out;
  }

  /** 复制到新 id, 原会话不动 */
  fork(): SessionStore {
    const next = new SessionStore();
    if (existsSync(this.path)) copyFileSync(this.path, next.path);
    return next;
  }

  /** 改文件之前调。只记第一次的原始态, 后面再改不覆盖 */
  snapshot(file: string): void {
    if (this.snapshots.has(file)) return;
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
