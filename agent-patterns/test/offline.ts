/**
 * 离线测试: 不调 API。覆盖所有「由代码负责」的部分 ——
 * 这些部分错了, 模式的保护就是假的。用法: npm test
 */
import { readFileSync } from "node:fs";
import { bannedTermsIn } from "../src/rules.js";
import { mechanicalChecks } from "../src/review-rules.js";
import { files, loadCsv, summarize } from "../src/stores.js";
import { loadChunks, BM25, verifyCitations, tokenize } from "../src/rag-index.js";

let fail = 0;
const t = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); if (!ok) fail++; };

/* rules */
const draft = readFileSync("data/proposal-draft.md", "utf8");
t("提案ドラフトの社内用語を検出", bannedTermsIn(draft).includes("lark-cli"), bannedTermsIn(draft).join(","));

/* review-rules */
const r3 = "誕生日のサプライズでデザートプレートを用意してもらえました。スタッフの山本さんの対応が本当に素敵でした！";
const good = "このたびは池袋西口店をご利用いただき、誠にありがとうございます。お誕生日のお祝いにデザートプレートを喜んでいただけたとのこと、スタッフ一同大変うれしく思っております。いただいたお言葉は担当者にも必ず伝えます。またの節目にも、ぜひ当店で特別な時間をお過ごしください。心よりお待ちしております。";
t("合格する返信は指摘なし", mechanicalChecks(good, r3).length === 0, JSON.stringify(mechanicalChecks(good, r3)));
t("スタッフ名を検出", mechanicalChecks(good + "山本も喜んでおります。", r3).some((m) => m.includes("山本")));
t("短すぎを検出", mechanicalChecks("ありがとうございました。", r3).some((m) => m.includes("短すぎ")));
t("「店員さん」は人名扱いしない", mechanicalChecks(good.replace("スタッフ一同", "店員一同"), "店員さんに聞いても").length === 0);

/* stores: 埋めた異常を代码能算出来 */
t("CSV 6 店舗", files.length === 6);
const s = Object.fromEntries(files.map((f) => [f.slice(0, 3), summarize(loadCsv(f))]));
t("S03 廃棄が急増", (s.S03!.changePct.waste_kg ?? 0) > 50, `${s.S03!.changePct.waste_kg}%`);
t("S05 温度アラート", s.S05!.alertDays.length >= 3, s.S05!.alertDays.join(" "));
t("S06 平日売上が急落", (s.S06!.changePct.weekday_sales ?? 0) < -20, `${s.S06!.changePct.weekday_sales}%`);
t("S01 は平常", Math.abs(s.S01!.changePct.sales ?? 99) < 15 && s.S01!.alertDays.length === 0, `${s.S01!.changePct.sales}%`);
let threw = false; try { loadCsv("../../package.json"); } catch { threw = true; }
t("パス・トラバーサルを拒否", threw);

/* rag */
const chunks = loadChunks();
const idx = new BM25(chunks);
const top = (q: string) => idx.search(q, 3)[0]?.chunk.id ?? "-";
t("小節で分割", chunks.length === 13, String(chunks.length));
t("tokenize: 英数字はまとまり", tokenize("TLS 1.2 と AES-256").includes("aes-256"));
t("データ保管 → 02#1", top("データはどこの国に保存されますか") === "02_datacenter#1", top("データはどこの国に保存されますか"));
t("ISMAP → 01#3", top("ISMAP 登録") === "01_certifications#3", top("ISMAP 登録"));
t("事業継続 復旧時間 → 05#2", top("事業継続 障害 復旧") === "05_bcp#2", top("事業継続 障害 復旧"));
const bcp = idx.search("BCP", 3);
t("「BCP」そのままではヒットしない (= 言い換えが要る理由)", bcp.length === 0, JSON.stringify(bcp.map((h) => h.chunk.id)));
const all = new Set(chunks.map((c) => c.id));
const v = verifyCitations("国内です[02_datacenter#1]。復旧4時間[05_bcp#2]。[99_fake#1]", new Set(["02_datacenter#1"]), all);
t("存在しない出典を検出", v.unknown.join() === "99_fake#1");
t("検索していない出典を検出", v.notRetrieved.join() === "05_bcp#2");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
