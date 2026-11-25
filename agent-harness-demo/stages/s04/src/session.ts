import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * 一次会话的状态。现在只放文件快照 (I3「可撤销」那一支);
 * Stage 09 会往这里加 JSONL 日志、resume、fork。
 */
export class SessionStore {
  readonly id: string;
  private snapshots = new Map<string, string | null>();

  constructor(id?: string) {
    this.id = id ?? randomUUID();
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
