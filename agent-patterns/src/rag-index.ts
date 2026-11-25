/**
 * 模式 6 的检索层: 按「## 小节」切块 + 字符 bigram 的 BM25。
 * 不依赖向量库, 方便离线跑和单测。换成向量 / 混合检索时, 只要保持 search() 的签名不变。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Chunk { id: string; doc: string; title: string; text: string }

/** 切块: 一个 ## 小节 = 一块。id 形如 "02_datacenter#1", 引用时用它 */
export function loadChunks(dir = "data/kb"): Chunk[] {
  const out: Chunk[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
    const doc = f.replace(/\.md$/, "");
    const raw = readFileSync(join(dir, f), "utf8");
    const h1 = raw.match(/^# (.+)$/m)?.[1] ?? doc;
    raw.split(/^## /m).slice(1).forEach((sec, i) => {
      const [title, ...body] = sec.split("\n");
      out.push({ id: `${doc}#${i + 1}`, doc, title: `${h1} / ${title!.trim()}`, text: body.join("\n").trim() });
    });
  }
  return out;
}

/** 日语没有空格, 用字符 bigram 当词。英数字串整体算一个词 (TLS, AES-256, ISO) */
export function tokenize(s: string): string[] {
  const t = s.toLowerCase();
  const words = t.match(/[a-z0-9][a-z0-9.\-/]*/g) ?? [];
  const ja = t.replace(/[a-z0-9.\-/\s、。・（）()「」:：,]+/g, " ").split(" ").filter(Boolean);
  const grams = ja.flatMap((w) => (w.length === 1 ? [w] : Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))));
  return [...words, ...grams];
}

export class BM25 {
  private docs: { chunk: Chunk; tf: Map<string, number>; len: number }[];
  private df = new Map<string, number>();
  private avg: number;
  constructor(chunks: Chunk[], private k1 = 1.5, private b = 0.75) {
    this.docs = chunks.map((chunk) => {
      const toks = tokenize(`${chunk.title} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      return { chunk, tf, len: toks.length };
    });
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }
  search(query: string, k = 3): { chunk: Chunk; score: number }[] {
    const N = this.docs.length;
    const q = [...new Set(tokenize(query))];
    return this.docs.map((d) => {
      let score = 0;
      for (const w of q) {
        const f = d.tf.get(w); if (!f) continue;
        const n = this.df.get(w)!;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * d.len / this.avg));
      }
      return { chunk: d.chunk, score: Math.round(score * 100) / 100 };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** 引用核验: 回答里的每个 [id] 都必须真实存在, 而且是本次检索里拿到过的 */
export function verifyCitations(answer: string, retrieved: Set<string>, all: Set<string>) {
  const cited = [...answer.matchAll(/\[([0-9a-z_]+#\d+)\]/g)].map((m) => m[1]!);
  return {
    cited,
    unknown: cited.filter((c) => !all.has(c)),                       // 编造的出处
    notRetrieved: cited.filter((c) => all.has(c) && !retrieved.has(c)), // 存在但这次没检索到 = 凭记忆
  };
}
