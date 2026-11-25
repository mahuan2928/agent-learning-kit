/**
 * 本地模型: embedding (multilingual-e5-small, 384 维) + 重排 (bge-reranker-v2-m3)。
 * 都跑在本机 CPU 上, 不需要 API key。首次运行会下载到 .models/ (约 700MB)。
 *
 * 选型要点:
 *  - e5 系列要求加前缀: 查询用 "query: ", 文档用 "passage: "。漏了效果会明显下降
 *  - embedding 结果按文本哈希缓存到 .cache/, 换切块策略时只算新出现的块
 *  - 换 embedding 模型 = 重建全部索引。所以模型名写进缓存键, 不会混用
 */
import { pipeline, env, AutoTokenizer, AutoModelForSequenceClassification,
         type FeatureExtractionPipeline, type PreTrainedTokenizer, type PreTrainedModel } from "@huggingface/transformers";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

env.cacheDir = ".models";
export const EMBED_MODEL = "Xenova/multilingual-e5-small";
export const RERANK_MODEL = "onnx-community/bge-reranker-v2-m3-ONNX";

/* ── embedding ───────────────────────────────────────────────── */
let embedder: FeatureExtractionPipeline | undefined;
const CACHE = `.cache/embed-${EMBED_MODEL.replace(/\W/g, "_")}.json`;
let cache: Record<string, number[]> | undefined;

function loadCache() {
  if (cache) return cache;
  cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  return cache!;
}

export async function embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  const c = loadCache();
  const keyed = texts.map((t) => `${kind}: ${t}`);
  const key = (s: string) => createHash("sha1").update(s).digest("hex");
  const missing = [...new Set(keyed.filter((t) => !c[key(t)]))];
  if (missing.length) {
    embedder ??= await pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8" });
    for (let i = 0; i < missing.length; i += 16) {
      const batch = missing.slice(i, i + 16);
      const out = (await embedder(batch, { pooling: "mean", normalize: true })).tolist() as number[][];
      batch.forEach((t, j) => (c[key(t)] = out[j]!.map((x) => Math.round(x * 1e5) / 1e5)));
    }
    mkdirSync(".cache", { recursive: true });
    writeFileSync(CACHE, JSON.stringify(c));
  }
  return keyed.map((t) => c[key(t)]!);
}

export const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);   // 已归一化

/* ── 重排 (cross-encoder) ────────────────────────────────────── */
let rr: { tok: PreTrainedTokenizer; model: PreTrainedModel } | undefined;

/** 对 (query, 文本) 逐对打分。分数是 logit: 越大越相关, 0 附近大约是「相关与否」的分界 */
export async function rerankScores(query: string, texts: string[]): Promise<number[]> {
  if (!texts.length) return [];
  rr ??= {
    tok: await AutoTokenizer.from_pretrained(RERANK_MODEL),
    model: await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: "q8" }),
  };
  const out: number[] = [];
  for (let i = 0; i < texts.length; i += 8) {
    const batch = texts.slice(i, i + 8);
    const inputs = rr.tok(new Array(batch.length).fill(query), { text_pair: batch, padding: true, truncation: true, max_length: 512 });
    const { logits } = await rr.model(inputs);
    out.push(...(logits.tolist() as number[][]).map((x) => x[0]!));
  }
  return out;
}
