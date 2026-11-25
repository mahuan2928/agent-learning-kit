/**
 * ② 切块。五种策略, 同一套评测集上比较 (实验 E1)。
 *
 *  fixed-200      : 每 200 字一刀。最常见的默认值, 也最容易把表头和表行切开
 *  fixed-200-o50  : 200 字一块, 相邻块重叠 50 字。缓解边界问题, 代价是块数变多
 *  section        : 按「## 小节」切。一个小节 = 一个语义单元
 *  section+ctx    : 按小节切, 并在用于检索的文本前加上「文書名 > 見出し」(contextual chunking)
 *  section-300    : 在 section+ctx 基础上, 超过 300 字的小节按行再切; Q/A 两行、表头和表行不拆开
 *
 * 每块保留两份文本: text 是原文 (用于展示和引用), indexText 是给检索用的 (可以加前缀)。
 */
import type { Doc, Role } from "./corpus.js";

export interface Chunk {
  id: string;              // "D01#3" —— 引用时用它
  docId: string;
  docTitle: string;
  heading: string;
  text: string;            // 原文
  indexText: string;       // 检索用文本
  acl: Role[];
  updatedAt: string;
  superseded: boolean;     // 已被新版取代
}

export type Strategy = "fixed-200" | "fixed-200-o50" | "section" | "section+ctx" | "section-300";
export const STRATEGIES: Strategy[] = ["fixed-200", "fixed-200-o50", "section", "section+ctx", "section-300"];

const meta = (d: Doc) => ({ docId: d.id, docTitle: d.title, acl: d.acl, updatedAt: d.updatedAt, superseded: !!d.supersededBy });

function sections(d: Doc): { heading: string; text: string }[] {
  return d.body.split(/^## /m).slice(1).map((s) => {
    const [h, ...rest] = s.split("\n");
    return { heading: h!.trim(), text: rest.join("\n").trim() };
  });
}

function fixed(d: Doc, size: number, overlap: number): Chunk[] {
  // 去掉标题行, 只切正文 —— 和多数「按字数切」的实现一致
  const flat = d.body.replace(/^#+ .*$/gm, "").replace(/\n{2,}/g, "\n").trim();
  const out: Chunk[] = [];
  for (let start = 0, i = 1; start < flat.length; start += size - overlap, i++) {
    const text = flat.slice(start, start + size);
    out.push({ id: `${d.id}#${i}`, heading: "", text, indexText: text, ...meta(d) });
    if (start + size >= flat.length) break;
  }
  return out;
}

/** 把小节按行分组, 每组不超过 max 字。不可拆的单位: 「Q: + A:」两行、整张表 */
function splitSection(text: string, max: number): string[] {
  const units: string[] = [];
  for (const line of text.split("\n")) {
    const prev = units[units.length - 1];
    const glue = prev !== undefined && ((/^A:/.test(line) && /^Q:/.test(prev.split("\n").pop()!)) || (/^\|/.test(line) && /^\|/.test(prev.split("\n").pop()!)));
    if (glue) units[units.length - 1] = `${prev}\n${line}`; else units.push(line);
  }
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + u.length + 1 > max) { out.push(cur); cur = u; } else cur = cur ? `${cur}\n${u}` : u;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunk(docs: Doc[], s: Strategy): Chunk[] {
  return docs.flatMap((d) => {
    if (s === "fixed-200") return fixed(d, 200, 0);
    if (s === "fixed-200-o50") return fixed(d, 200, 50);
    if (s === "section-300") {
      let n = 0;
      return sections(d).flatMap((sec) => splitSection(sec.text, 300).map((text) => ({
        id: `${d.id}#${++n}`, heading: sec.heading, text,
        indexText: `${d.title} > ${sec.heading}\n${text}`, ...meta(d),
      })));
    }
    return sections(d).map((sec, i) => ({
      id: `${d.id}#${i + 1}`, heading: sec.heading, text: sec.text,
      indexText: s === "section+ctx" ? `${d.title} > ${sec.heading}\n${sec.text}` : sec.text,
      ...meta(d),
    }));
  });
}
