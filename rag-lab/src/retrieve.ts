/**
 * ③ 检索层: 三种召回 + 融合 + 过滤 + 重排, 全部可以单独开关, 方便做对照实验。
 *
 *   query ─┬→ BM25   ─┐
 *          └→ 向量   ─┴→ RRF 融合 → 过滤 (权限 / 旧版) → top 20 → 重排 → top k
 *
 * 过滤放在哪一步是个关键决策: 这里在【融合之前】对候选集过滤 (pre-filter)。
 * 先取 top k 再过滤 (post-filter) 会让结果凭空变少, 实验 E4 会量化这个差别。
 */
import type { Chunk } from "./chunkers.js";
import type { Role } from "./corpus.js";
import { BM25 } from "./bm25.js";
import { embed, cosine, rerankScores } from "./models.js";

export interface Hit { chunk: Chunk; score: number }
export type Mode = "bm25" | "vector" | "hybrid" | "bm25-raw" | "hybrid-raw";   // -raw = 不过滤平假名 bigram

export interface SearchOpts {
  mode?: Mode;
  k?: number;
  role?: Role;                         // 不给 = 不做权限过滤 (只在实验里这么用)
  filter?: "pre" | "post" | "none";    // 权限过滤放在哪
  dropSuperseded?: boolean;            // 去掉已被新版取代的文档
  rerank?: boolean;                    // 融合后取 top 20 交给 cross-encoder
}

export class Index {
  private bm25: BM25;
  private bm25raw: BM25;
  private vecs: number[][] = [];
  private constructor(readonly chunks: Chunk[]) {
    this.bm25 = new BM25(chunks.map((c) => c.indexText), true);
    this.bm25raw = new BM25(chunks.map((c) => c.indexText), false);
  }

  static async build(chunks: Chunk[]): Promise<Index> {
    const ix = new Index(chunks);
    ix.vecs = await embed(chunks.map((c) => c.indexText), "passage");
    return ix;
  }

  async search(query: string, o: SearchOpts = {}): Promise<Hit[]> {
    const { mode = "hybrid", k = 5, filter = o.role ? "pre" : "none", dropSuperseded = false, rerank = false } = o;
    const allowed = (c: Chunk) => (!o.role || c.acl.includes(o.role)) && (!dropSuperseded || !c.superseded);
    const candidates = this.chunks.map((_, i) => i).filter((i) => filter !== "pre" || allowed(this.chunks[i]!));

    const ranked = await this.rank(query, candidates, mode);
    let hits = ranked.map(({ i, score }) => ({ chunk: this.chunks[i]!, score }));
    if (filter === "post") hits = hits.slice(0, rerank ? 20 : k).filter((h) => allowed(h.chunk));   // 先截断再过滤
    else if (filter === "none" && dropSuperseded) hits = hits.filter((h) => !h.chunk.superseded);

    if (rerank) {
      const pool = hits.slice(0, 20);
      const s = await rerankScores(query, pool.map((h) => `${h.chunk.docTitle} ${h.chunk.heading}\n${h.chunk.text}`));
      hits = pool.map((h, j) => ({ chunk: h.chunk, score: s[j]! })).sort((a, b) => b.score - a.score);
    }
    return hits.slice(0, k);
  }

  private async rank(query: string, idx: number[], mode: Mode): Promise<{ i: number; score: number }[]> {
    const sortDesc = (xs: { i: number; score: number }[]) => xs.sort((a, b) => b.score - a.score);
    const raw = mode.endsWith("-raw");
    const bm = () => { const s = (raw ? this.bm25raw : this.bm25).scores(query); return sortDesc(idx.map((i) => ({ i, score: s[i]! })).filter((x) => x.score > 0)); };
    const vec = async () => { const [q] = await embed([query], "query"); return sortDesc(idx.map((i) => ({ i, score: cosine(q!, this.vecs[i]!) }))); };
    if (mode === "bm25" || mode === "bm25-raw") return bm();
    if (mode === "vector") return vec();
    return rrf([bm(), await vec()]);
  }
}

/**
 * Reciprocal Rank Fusion: 只看名次, 不看分数。
 * BM25 分数和余弦相似度的量纲完全不同, 直接相加没有意义; RRF 绕开了这个问题。k=60 是论文里的常用值。
 */
export function rrf(lists: { i: number; score: number }[][], k = 60): { i: number; score: number }[] {
  const s = new Map<number, number>();
  for (const list of lists) list.forEach((x, rank) => s.set(x.i, (s.get(x.i) ?? 0) + 1 / (k + rank + 1)));
  return [...s].map(([i, score]) => ({ i, score })).sort((a, b) => b.score - a.score);
}
