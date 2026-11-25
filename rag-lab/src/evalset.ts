/**
 * 评测集与检索指标。
 * 标准答案不是「哪个 chunk id」, 而是「哪段原文」(span): 只要某块包含这段原文就算命中。
 * 这样同一套标注可以评任何切块策略 —— 切块一变, chunk id 全变, 但原文不变。
 */
import { readFileSync } from "node:fs";
import type { Chunk } from "./chunkers.js";
import type { Role } from "./corpus.js";

export type QType = "keyword" | "paraphrase" | "table" | "stale" | "acl" | "noanswer" | "multi";
export interface Question {
  id: string; type: QType; role: Role; q: string;
  gold: { doc: string; span: string }[];
  answer: string;
  forbidden_docs: string[];
  stale_docs: string[];
}

export const loadQuestions = (): Question[] =>
  readFileSync("eval/questions.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));

const norm = (s: string) => s.replace(/\s+/g, "");
export const contains = (c: Chunk, span: string): boolean => norm(c.text).includes(norm(span));

/** 这道题的所有 span 是否都出现在前 k 块里 (多跳题要全部命中才算) */
export function hitAt(q: Question, ranked: Chunk[], k: number): boolean {
  const top = ranked.slice(0, k);
  return q.gold.every((g) => top.some((c) => c.docId === g.doc && contains(c, g.span)));
}

/** 第一个包含任一 span 的名次的倒数 (MRR 用) */
export function reciprocalRank(q: Question, ranked: Chunk[]): number {
  const r = ranked.findIndex((c) => q.gold.some((g) => c.docId === g.doc && contains(c, g.span)));
  return r < 0 ? 0 : 1 / (r + 1);
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
