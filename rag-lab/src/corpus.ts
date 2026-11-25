/**
 * ① 离线索引: 读取文档 + 元数据。
 * 元数据和正文一样重要: acl 决定谁能搜到, updated_at / supersedes 决定该信哪一版,
 * title 决定引用时显示什么。这些字段在切块时会原样带到每一块上。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Role = "staff" | "manager" | "hq" | "hr";

export interface Doc {
  id: string;
  title: string;
  dept: string;
  acl: Role[];
  updatedAt: string;
  supersedes?: string;
  supersededBy?: string;
  body: string;            // front matter 以外的 Markdown
}

export function loadDocs(dir = "corpus"): Doc[] {
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const raw = readFileSync(join(dir, f), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`${f}: front matter がありません`);
    const meta = Object.fromEntries(m[1]!.split("\n").map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }));
    for (const k of ["id", "title", "acl", "updated_at"]) if (!meta[k]) throw new Error(`${f}: ${k} がありません`);
    return {
      id: meta.id!, title: meta.title!, dept: meta.dept ?? "", updatedAt: meta.updated_at!,
      acl: meta.acl!.split(",").map((s: string) => s.trim()) as Role[],
      supersedes: meta.supersedes, supersededBy: meta.superseded_by,
      body: m[2]!.trim(),
    };
  });
}
