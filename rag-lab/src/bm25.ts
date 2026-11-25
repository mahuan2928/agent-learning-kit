/**
 * 关键词检索: 字符 bigram 的 BM25。日语没有空格, bigram 是最简单可用的分词。
 * 英数字串整体算一个词, 所以「E-221」「HACCP-07」这种编号能精确命中 —— 这是向量检索的弱项。
 */
/**
 * contentOnly=true 时丢掉纯平假名的 bigram (「どう」「され」「るの」…)。
 * 这是穷人版的「只留内容词」: 正经做法是用 Sudachi / MeCab 做形态素解析后去掉助词助动词。
 * 实验 E2 会比较开和不开的差别。
 */
export function tokenize(s: string, contentOnly = true): string[] {
  const t = s.toLowerCase().normalize("NFKC");
  const words = t.match(/[a-z0-9][a-z0-9.\-/%]*/g) ?? [];
  const ja = t.replace(/[a-z0-9.\-/%\s、。・（）()「」:：,|？?！!]+/g, " ").split(" ").filter(Boolean);
  const grams = ja.flatMap((w) => (w.length === 1 ? [w] : Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))));
  return [...words, ...(contentOnly ? grams.filter((g) => !/^[ぁ-んー]+$/.test(g)) : grams)];
}

export class BM25 {
  private tf: Map<string, number>[];
  private len: number[];
  private df = new Map<string, number>();
  private avg: number;

  constructor(texts: string[], private contentOnly = true, private k1 = 1.5, private b = 0.75) {
    this.tf = texts.map((t) => {
      const m = new Map<string, number>();
      for (const w of tokenize(t, contentOnly)) m.set(w, (m.get(w) ?? 0) + 1);
      for (const w of m.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      return m;
    });
    this.len = texts.map((t) => tokenize(t, contentOnly).length);
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, texts.length);
  }

  /** 返回每个文本的分数 (和构造时的顺序一致) */
  scores(query: string): number[] {
    const N = this.tf.length;
    const q = [...new Set(tokenize(query, this.contentOnly))];
    return this.tf.map((tf, i) => {
      let s = 0;
      for (const w of q) {
        const f = tf.get(w); if (!f) continue;
        const n = this.df.get(w)!;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.len[i]!) / this.avg));
      }
      return s;
    });
  }
}
