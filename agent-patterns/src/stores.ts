/** 模式 4 的 worker 工具实现。纯代码, 不调模型 —— 数字一律由代码算 */
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const DIR = "data/stores";
export const files = readdirSync(DIR).filter((f) => f.endsWith(".csv"));

export interface Row { date: string; weekday: string; sales_yen: number; customers: number; waste_kg: number; temp_alerts: number }
export function loadCsv(file: string): Row[] {
  const name = basename(file);                                   // 路径穿越防护: 只取文件名
  if (!files.includes(name)) throw new Error(`${name} は参照できません`);
  const [head, ...lines] = readFileSync(join(DIR, name), "utf8").trim().split("\n");
  const cols = head!.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], i >= 2 ? Number(v) : v])) as unknown as Row);
}
export function summarize(rows: Row[]) {
  const half = (rs: Row[]) => ({
    sales: rs.reduce((s, r) => s + r.sales_yen, 0),
    customers: rs.reduce((s, r) => s + r.customers, 0),
    waste_kg: Math.round(rs.reduce((s, r) => s + r.waste_kg, 0) * 10) / 10,
    temp_alerts: rs.reduce((s, r) => s + r.temp_alerts, 0),
    weekday_sales: rs.filter((r) => !"金土日".includes(r.weekday)).reduce((s, r) => s + r.sales_yen, 0),
  });
  const prev = half(rows.slice(0, 7)), cur = half(rows.slice(7));
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);
  return { prevWeek: prev, thisWeek: cur,
    changePct: { sales: pct(cur.sales, prev.sales), customers: pct(cur.customers, prev.customers),
                 waste_kg: pct(cur.waste_kg, prev.waste_kg), weekday_sales: pct(cur.weekday_sales, prev.weekday_sales) },
    alertDays: rows.slice(7).filter((r) => r.temp_alerts > 0).map((r) => `${r.date}(${r.temp_alerts})`) };
}
