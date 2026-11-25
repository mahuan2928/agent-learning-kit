#!/usr/bin/env python3
"""RAG 入门页。演示数据来自 tools/demo-data.json (由 demo_data.ts 用本地模型算出)。
用法: python3 tools/build_intro.py → tools/rag-intro.html"""
import json, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(R, "tools/demo-data.json"), encoding="utf8"))
css = open(os.path.join(R, "tools/style.css"), encoding="utf8").read()
css = css.replace("/* RAG 实验手册: 左侧章节导轨 + 正文列。每章 = 对应框架章节 + 代码 + 实测数字 + 搞坏实验 + 面试话术 */",
                  "/* RAG 入门: 单列阅读 + 一个可操作的演示台。演示台是页面的主角, 其余是围绕它的讲解 */")

EXTRA = r'''
.intro main{max-width:820px}
.analogy{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);margin:0 0 22px}
.analogy div{background:var(--surface);padding:14px 16px}
.analogy b{display:block;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--a1);margin-bottom:6px}
.analogy p{margin:0;font-size:15.5px;line-height:1.55}
.steps{list-style:none;padding:0;margin:0 0 22px;display:grid;gap:12px;max-width:none}
.steps li{margin:0;display:grid;grid-template-columns:44px 1fr;gap:14px;align-items:start;background:var(--surface);border:1px solid var(--rule);padding:14px 16px}
.steps .no{font-family:var(--f-display);font-weight:700;font-size:26px;color:var(--a1);line-height:1}
.steps h4{font-family:var(--f-display);font-size:17px;margin:0 0 4px}
.steps p{margin:0;font-size:15.5px}
.steps .eg{font-family:var(--f-mono);font-size:12px;color:var(--muted);margin-top:6px}
.steps .when{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.1em;color:var(--a2);text-transform:uppercase}

/* 演示台 */
.lab{border:2px solid var(--ink);background:var(--surface);margin:0 0 28px;max-width:min(100%,980px)}
.lab-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:12px 16px;border-bottom:1px solid var(--rule);background:var(--surface-2)}
.lab-h .t{font-family:var(--f-mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:var(--ink)}
.lab-sec{padding:14px 16px;border-bottom:1px solid var(--rule)}
.lab-sec:last-child{border-bottom:none}
.lab-sec>.lbl{display:block;font-family:var(--f-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--a1);font-weight:600;margin-bottom:8px}
.qs{display:flex;flex-wrap:wrap;gap:8px}
.qbtn,.mode button{font:inherit;font-size:14px;padding:6px 12px;border:1px solid var(--rule-strong);background:var(--paper);color:var(--ink);border-radius:999px;cursor:pointer;line-height:1.35}
.qbtn:hover,.mode button:hover{border-color:var(--a1)}
.qbtn[aria-pressed="true"],.mode button[aria-pressed="true"]{background:var(--a1);border-color:var(--a1);color:var(--paper)}
.qbtn:focus-visible,.mode button:focus-visible,#custom:focus-visible{outline:2px solid var(--a1);outline-offset:2px}
.qbtn small{color:inherit;opacity:.7;font-family:var(--f-mono);margin-right:4px}
.custom{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
#custom{flex:1 1 240px;min-width:0;font:inherit;font-size:15px;padding:7px 10px;border:1px solid var(--rule-strong);background:var(--paper);color:var(--ink)}
.mode{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mode .hint{font-size:13px;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.card{border:1px solid var(--rule);background:var(--paper);padding:10px 12px;font-size:13.5px;line-height:1.5;position:relative;min-width:0}
.card.top{border:2px solid var(--a1);background:var(--a1-bg);padding:9px 11px}
.card .meta{display:flex;justify-content:space-between;gap:8px;font-family:var(--f-mono);font-size:11px;color:var(--muted);margin-bottom:4px}
.card .rank{font-weight:700;color:var(--a1)}
.card .score{font-variant-numeric:tabular-nums}
.card h5{font-family:var(--f-display);font-size:14px;margin:0 0 4px;color:var(--ink)}
.card .body{color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
.card mark{background:var(--a2-bg);color:var(--a2);font-weight:600;padding:0 1px}
.tag{display:inline-block;font-family:var(--f-mono);font-size:10px;font-weight:600;padding:0 6px;border-radius:2px;margin-left:4px}
.tag.old{background:var(--danger-bg);color:var(--danger)}
.tag.ans{background:var(--ok-bg);color:var(--ok)}
.explain{border-left:3px solid var(--a2);background:var(--a2-bg);padding:12px 16px;font-size:15px;line-height:1.6}
.explain p{margin:0;max-width:none}
.explain p+p{margin-top:6px}
#prompt{margin:0;max-height:260px;overflow:auto;white-space:pre-wrap;font-size:12px}
.pits{display:grid;gap:10px;margin:0 0 22px}
.pit{display:grid;grid-template-columns:150px 1fr;gap:14px;background:var(--surface);border:1px solid var(--rule);padding:12px 16px}
.pit b{font-family:var(--f-display);font-size:15px}
.pit p{margin:0;font-size:15px}
.pit .fix{font-family:var(--f-mono);font-size:12px;color:var(--ok);margin-top:4px}
@media(max-width:560px){.pit{grid-template-columns:1fr;gap:4px}.steps li{grid-template-columns:32px 1fr}}
figure{margin:0 0 22px;max-width:min(100%,640px)}
figcaption{font-size:13px;color:var(--muted);margin-top:6px}
svg text{font-family:var(--f-mono)}
'''

HTML = r'''<title>RAG 入门</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>__CSS__</style>
<div class="shell intro">
<header class="masthead">
  <div class="stamp"><span>入门篇</span><span>下一篇 <b>RAG 设计实战</b></span><span>约 30 分钟</span></div>
  <h1>RAG 入门</h1>
  <p class="dek">让 AI <em>看着你公司的资料</em>回答问题。这一页不需要任何基础：先用一个比喻讲清楚它是什么，再用一个能直接点的演示，让你亲眼看到它是怎么找资料的、会在哪里出错。</p>
</header>
<main>

<section class="stage" id="why">
  <div class="stage-head"><span class="stage-num">01 · 为什么需要它</span><h2>AI 没读过你公司的规程</h2></div>
  <p>Claude 这样的模型读过大量公开资料，但它<strong>没读过</strong>某家餐饮公司的内部规程。你问它「交通费一天能报多少」，它只能说不知道，或者编一个看起来合理的数字。后一种更危险。</p>
  <p>要让它答得出来，有两条路：</p>
  <div class="tw"><table>
    <thead><tr><th></th><th>重新训练模型</th><th>RAG：提问时把资料递给它</th></tr></thead>
    <tbody>
      <tr><td>做法</td><td>把公司资料「教」进模型里</td><td>每次提问时，先找出相关的几段资料，和问题一起交给模型</td></tr>
      <tr><td>规程改了怎么办</td><td>要重新训练</td><td>换掉资料就行，下一次提问立刻生效</td></tr>
      <tr><td>能不能说出出处</td><td>很难</td><td>能，答案来自哪一段资料是明确的</td></tr>
      <tr><td>谁能看什么</td><td>很难控制</td><td>找资料时按权限过滤就行</td></tr>
    </tbody>
  </table></div>
  <p>所以企业里「让 AI 回答公司内部问题」，几乎都用第二条路。<strong>RAG</strong> 是 Retrieval-Augmented Generation 的缩写，直译是「检索增强生成」：先<strong>检索</strong>（找资料），再<strong>生成</strong>（写回答）。</p>
</section>

<section class="stage" id="analogy">
  <div class="stage-head"><span class="stage-num">02 · 一个比喻</span><h2>开卷考试</h2></div>
  <div class="analogy">
    <div><b>模型</b><p>一个很聪明、但没读过这家公司规程的学生。</p></div>
    <div><b>RAG</b><p>考试时，有个助手先帮他把规程翻到相关的那几页，摊在桌上。</p></div>
    <div><b>回答</b><p>学生看着这几页作答，并且写明「答案在第几页」。</p></div>
  </div>
  <p>注意：学生本身没有变聪明，也没有「记住」规程。<strong>每次答题，都是看着当场翻开的那几页</strong>。所以 RAG 好不好，关键在于助手<strong>翻没翻对页</strong>。翻错了，学生再聪明也答不对。这一点贯穿整页。</p>
</section>

<section class="stage" id="steps">
  <div class="stage-head"><span class="stage-num">03 · 三个步骤</span><h2>切卡片、找卡片、看着卡片回答</h2></div>
  <ol class="steps">
    <li><span class="no">1</span><div><span class="when">事先做一次</span><h4>把资料切成小卡片</h4><p>一份规程很长，整份交给模型既浪费又容易让它看漏。所以先按段落切成一张张小卡片，每张讲一件事。这一步叫<strong>切块</strong>（chunking）。</p><p class="eg">就業規則 → 「勤務時間」「休憩」「時間外労働と手当」「有給休暇」…</p></div></li>
    <li><span class="no">2</span><div><span class="when">每次提问</span><h4>找出和问题最相关的几张</h4><p>拿到问题后，从所有卡片里挑出最相关的 3 到 5 张。这一步叫<strong>检索</strong>（retrieval），是整个 RAG 里最难、最影响效果的一步。</p><p class="eg">「交通費は1日いくらまで？」→ 経費精算規程 > 交通費</p></div></li>
    <li><span class="no">3</span><div><span class="when">每次提问</span><h4>把卡片和问题一起交给模型</h4><p>告诉模型：「只根据这几张卡片回答，卡片里没有就说不知道，并写明出自哪一张。」这一步叫<strong>生成</strong>（generation）。</p><p class="eg">「交通費の上限は1日3,000円です。［経費精算規程（2026年版）> 交通費］」</p></div></li>
  </ol>
  <p>下面的演示台把第 2、3 步做成了可以点的样子。卡片是从一家虚构连锁餐饮公司的规程里切出来的 13 张。</p>
</section>

<section class="stage" id="demo">
  <div class="stage-head"><span class="stage-num">04 · 动手玩</span><h2>演示台：看 AI 怎么找卡片</h2></div>
  <p><strong>建议按顺序点 Q1 到 Q6</strong>，每个问题下面都有一段「这个例子说明了什么」。然后在两种找法之间切换，看排名怎么变。</p>

  <div class="lab" id="lab">
    <div class="lab-h"><span class="t">RAG 演示台</span></div>
    <div class="lab-sec"><span class="lbl">① 提一个问题</span>
      <div class="qs" id="qs"></div>
      <div class="custom"><input id="custom" type="text" placeholder="或者自己输入一个问题（日语），按回车" aria-label="自己输入问题"><button class="qbtn" id="customGo" type="button">找卡片</button></div>
    </div>
    <div class="lab-sec"><span class="lbl">② 找卡片（检索）</span>
      <div class="mode" id="mode">
        <button type="button" data-m="kw" aria-pressed="true">按字找</button>
        <button type="button" data-m="vec" aria-pressed="false">按意思找</button>
        <span class="hint" id="modeHint"></span>
      </div>
    </div>
    <div class="lab-sec" id="explainSec"><div class="explain" id="explain"></div></div>
    <div class="lab-sec"><span class="lbl">13 张卡片，按相关程度排序 · 蓝框 = 选中交给模型的前 3 张</span>
      <div class="cards" id="cards"></div>
    </div>
    <div class="lab-sec"><span class="lbl">③ 实际交给模型的内容（生成）</span>
      <pre id="prompt"><code></code></pre>
    </div>
  </div>
</section>

<section class="stage" id="two-ways">
  <div class="stage-head"><span class="stage-num">05 · 两种找法</span><h2>按字找 vs 按意思找</h2></div>
  <p><strong>按字找</strong>：数问题和卡片之间有多少相同的词，越多越相关。演示台里用的是最简单的版本，正式名字叫 <strong>BM25</strong>，原理一样，只是会给「少见的词」更高的权重。</p>
  <ul><li>擅长：编号、型号、专有名词。「E-221」这种字面必须完全一致的，它最准。</li>
      <li>不擅长：换了说法。问「残業代」，规程里写「時間外労働手当」，一个共同的词都没有。</li></ul>
  <p><strong>按意思找</strong>：先用一个模型把每段文字变成一串数字，叫<strong>向量</strong>（embedding）。可以想象成给每段话在「意思地图」上标一个坐标：意思相近的话，坐标就靠得近。提问时，把问题也标到地图上，找离它最近的卡片。</p>
  <figure>
    <svg viewBox="0 0 520 250" role="img" aria-label="意思地图示意图：残業代和時間外労働手当的点靠在一起，冷蔵庫的温度离得很远">
      <rect x="1" y="1" width="518" height="248" fill="var(--surface)" stroke="var(--rule)"/>
      <circle cx="140" cy="80" r="7" fill="var(--a2)"/><text x="154" y="84" font-size="13" fill="var(--ink)">問題：残業代はどう計算？</text>
      <circle cx="120" cy="120" r="7" fill="var(--a1)"/><text x="134" y="124" font-size="13" fill="var(--ink)">時間外労働手当は…1.25</text>
      <circle cx="170" cy="150" r="7" fill="var(--a1)"/><text x="184" y="154" font-size="13" fill="var(--ink)">深夜労働は0.25加算</text>
      <circle cx="420" cy="200" r="7" fill="var(--faint)"/><text x="300" y="228" font-size="13" fill="var(--muted)">冷蔵庫は10℃以下</text>
      <circle cx="400" cy="60" r="7" fill="var(--faint)"/><text x="300" y="42" font-size="13" fill="var(--muted)">パスワードは12文字以上</text>
      <line x1="140" y1="80" x2="120" y2="120" stroke="var(--a1)" stroke-dasharray="3 3"/>
    </svg>
    <figcaption>示意图。真实的「地图」有几百个维度（这里用的模型是 384 维），画不出来，但道理一样：离得近 = 意思相近。</figcaption>
  </figure>
  <ul><li>擅长：换说法、口语。</li>
      <li>不擅长：只差一个数字的编号（E-221 和 E-222 意思几乎一样）；而且分数都挤在一起（演示里几乎都在 0.8 左右），<strong>只能看排名，不能看绝对值</strong>。</li></ul>
  <p>两种各有短板，所以实际系统通常<strong>两种一起用</strong>（叫<strong>混合检索</strong>），再加一步更仔细的「复查排名」（叫<strong>重排</strong>）。这些就是下一篇实战页讲的内容。</p>
</section>

<section class="stage" id="pits">
  <div class="stage-head"><span class="stage-num">06 · 会在哪里出错</span><h2>演示台里看到的 6 个坑，就是实战页的 6 章</h2></div>
  <p>RAG 的原理三句话就讲完了，难的全在「找卡片」这一步会出各种错。实战篇那一页之所以有那么多章，就是在一个个解决下面这些问题：</p>
  <div class="pits">
    <div class="pit"><b>卡片切坏了</b><div><p>表格的表头和数据被切到两张卡片上，找到了数据也看不懂。</p><p class="fix">→ 实战篇 02 切块</p></div></div>
    <div class="pit"><b>换个说法就找不到</b><div><p>Q2：问「残業代」，按字找一张都对不上。</p><p class="fix">→ 实战篇 03 召回（按意思找、混合检索）</p></div></div>
    <div class="pit"><b>找到了，但排名靠后</b><div><p>Q2、Q4：按意思找，正确答案只排第 2、第 3。</p><p class="fix">→ 实战篇 04 重排（再仔细排一次）</p></div></div>
    <div class="pit"><b>找到了不该看的</b><div><p>普通员工问工资，却翻到了只有人事部能看的工资表。</p><p class="fix">→ 实战篇 05 权限过滤（找之前先排除）</p></div></div>
    <div class="pit"><b>找到了旧版本</b><div><p>Q1：2024 年的旧规程排在 2026 年新规程前面。</p><p class="fix">→ 实战篇 06 新旧版本</p></div></div>
    <div class="pit"><b>根本没有答案，也「找到了」</b><div><p>Q6：资料里没有员工宿舍，检索照样返回 3 张卡片。如果模型硬答，就是编造。</p><p class="fix">→ 实战篇 07 拒答、08 核验</p></div></div>
  </div>
  <p>还有一个贯穿所有章节的问题：<strong>改了一处，怎么知道是变好了还是变坏了？</strong>答案是先准备一套「问题 + 正确答案在哪张卡片」的题目（叫<strong>评测集</strong>），每改一次就全部跑一遍，看命中率。实战篇里所有的百分比都是这么来的。</p>
</section>

<section class="stage" id="glossary">
  <div class="stage-head"><span class="stage-num">07 · 小词典</span><h2>实战篇里会遇到的词</h2></div>
  <div class="tw"><table>
    <thead><tr><th>词</th><th>一句话解释</th><th>开卷考试里对应</th></tr></thead>
    <tbody>
      <tr><td>Chunk / 切块</td><td>把长文档切成一段段小卡片</td><td>把规程拆成一页页</td></tr>
      <tr><td>Retrieval / 检索</td><td>找出和问题相关的卡片</td><td>助手翻页</td></tr>
      <tr><td>BM25</td><td>按相同的词打分的找法</td><td>按目录里的关键词找</td></tr>
      <tr><td>Embedding / 向量</td><td>把一段话变成「意思地图」上的坐标</td><td>按内容大意找</td></tr>
      <tr><td>混合检索（Hybrid）</td><td>两种找法的结果合并</td><td>目录和大意都查一遍</td></tr>
      <tr><td>Rerank / 重排</td><td>对找到的前 20 张，再逐张仔细判断相关程度，重新排序</td><td>翻到 20 页后，再逐页确认</td></tr>
      <tr><td>Top-k</td><td>最终取前几张交给模型（常见 3 到 5）</td><td>摊在桌上的页数</td></tr>
      <tr><td>Recall@k / 召回率</td><td>正确答案有没有出现在前 k 张里，按百分比统计</td><td>助手翻对页的比例</td></tr>
      <tr><td>引用（Citation）</td><td>回答里标明每句话出自哪张卡片</td><td>「答案在第几页」</td></tr>
      <tr><td>幻觉（Hallucination）</td><td>模型说了卡片里没有的内容</td><td>学生凭印象瞎写</td></tr>
      <tr><td>评测集</td><td>一套标好正确答案的题目，用来衡量改动的效果</td><td>模拟考试和标准答案</td></tr>
    </tbody>
  </table></div>
</section>

<section class="stage" id="next">
  <div class="stage-head"><span class="stage-num">08 · 接下来</span><h2>怎么从这里走到实战篇</h2></div>
  <ol>
    <li><strong>今天</strong>：把演示台 6 个问题都点一遍，两种找法都切换看看。能用自己的话说出「为什么 Q2 按字找不到」「为什么 Q6 也会找到卡片」，这一页就算懂了。</li>
    <li><strong>明天</strong>：读实战篇的 <a href="rag-design-lab.html#s2">02 切块</a>、<a href="rag-design-lab.html#s3">03 召回</a>、<a href="rag-design-lab.html#s4">04 重排</a>。只看每章开头的说明和表格，代码先跳过。</li>
    <li><strong>第三天</strong>：读 05 到 07（权限、新旧版本、拒答），对照上面「6 个坑」。</li>
    <li><strong>最后</strong>：读 08 状态图，这时再看代码。它就是把上面三个步骤加上各种检查，串成一条流水线。</li>
  </ol>
  <div class="qa"><span class="lbl">面试时的入门版回答</span><div class="body">
    <p><strong>「什么是 RAG？」</strong>模型没读过企业内部资料，所以每次提问时，先从资料库里检索出最相关的几段，和问题一起交给模型，要求它只根据这些资料回答并注明出处。好处是资料更新立即生效、能给出处、能按权限控制。难点集中在检索：换个说法找不到、找到旧版本、找到无权查看的内容、资料里没有答案时模型硬答。所以实际系统会加混合检索、重排、权限过滤和回答核验，并用评测集衡量每一处改动。</p>
  </div></div>
</section>
</main></div>

<script>
const DATA = __DATA__;
const EXPLAIN = [
  { kw: "按字找：两版规程都有「交通費」「精算」，<strong>2024 年旧版排第 1</strong>，2026 年新版排第 2。",
    vec: "按意思找：结果一样，<strong>旧版还是排第 1</strong>（0.909 对 0.908，几乎相同）。",
    lesson: "两版的文字几乎一样，不管按字还是按意思都分不出「哪一版现在有效」。如果模型照着旧版回答，就会说「2,000 円」，而现行规定是 3,000 円。这只能靠给卡片标上「已被新版取代」来解决。" },
  { kw: "按字找：<strong>一个共同的词都没有</strong>，所有卡片都是 0 分，排名毫无意义。",
    vec: "按意思找：正确答案「時間外労働と手当」找到了，但<strong>只排第 3</strong>，前两名是交通费。",
    lesson: "规程里写的是「時間外労働手当」，口语说「残業代」。按字找完全失效，按意思找能找到但排不准。这就是为什么需要「按意思找」，也是为什么后面还要加一步「重排」。" },
  { kw: "按字找：「E-221」这个编号精确命中，<strong>第 1 名</strong>，而且和其他卡片拉开了差距。",
    vec: "按意思找：也是第 1 名，但和第 2 名的分数差距小得多。",
    lesson: "编号、型号这类「字面必须一致」的问题，是按字找的强项。真实系统里错误码有几百个，E-221 和 E-222 在「意思地图」上很可能挨得非常近，这时按字找就是保底。" },
  { kw: "按字找：<strong>全部 0 分</strong>。规程里写的是「従業員割引」「本人を含む4名まで」，和「家族」「安く」没有共同的词。",
    vec: "按意思找：正确答案「従業員割引」<strong>排第 2</strong>，第 1 名是同一份文档里的「食事補助」。",
    lesson: "口语问法和规程用语差得越远，按字找越没用。按意思找能找到同一个主题，但同主题里谁更准，还需要更仔细的判断。" },
  { kw: "按字找：几乎没有共同的词，排名靠的是偶然。",
    vec: "按意思找：正确答案「インシデントの報告」<strong>排第 1</strong>。",
    lesson: "「スマホをなくした」和「端末の紛失…1時間以内に報告」字面上没有交集，但意思一致。这是按意思找最擅长的情况。" },
  { kw: "按字找：只有一张卡片碰巧有 1 个共同的词，但它仍然被选进了前 3。",
    vec: "按意思找：「福利厚生」相关的卡片排在前面，分数和其他问题差不多高。",
    lesson: "资料里根本没有员工宿舍的信息，但<strong>检索永远会返回「最相关的 3 张」</strong>，哪怕它们都不相关。如果模型拿着这 3 张硬答，就是编造。所以要在生成时要求「卡片里没有就说没有」，并在之后核验回答。" },
];

function tokenize(s) {
  const t = s.toLowerCase().normalize("NFKC");
  const words = t.match(/[a-z0-9][a-z0-9.\-/%]*/g) || [];
  const ja = t.replace(/[a-z0-9.\-/%\s、。・（）()「」:：,|？?！!]+/g, " ").split(" ").filter(Boolean);
  const grams = ja.flatMap(w => w.length === 1 ? [w] : Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2)));
  return [...words, ...grams.filter(g => !/^[ぁ-んー]+$/.test(g))];
}
const cardTokens = DATA.cards.map(c => new Set(tokenize(c.heading + " " + c.text)));
const esc = s => s.replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));

let state = { qi: 0, custom: "", mode: "kw" };

function current() {
  if (state.qi >= 0) return { q: DATA.questions[state.qi].q, preset: DATA.questions[state.qi], qi: state.qi };
  return { q: state.custom, preset: null, qi: -1 };
}

function scores(cur) {
  if (state.mode === "vec" && cur.preset) return cur.preset.vector.map(v => ({ v, label: v.toFixed(3), hits: [] }));
  const qt = [...new Set(tokenize(cur.q))];
  return cardTokens.map(set => { const hits = qt.filter(w => set.has(w)); return { v: hits.length, label: hits.length + " 个共同词", hits }; });
}

function highlight(text, hits) {
  if (!hits.length) return esc(text);
  const re = new RegExp("(" + hits.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|") + ")", "gi");
  return esc(text).replace(re, "<mark>$1</mark>");
}

function render() {
  const cur = current();
  if (!cur.preset && state.mode === "vec") state.mode = "kw";
  document.querySelectorAll("#qs .qbtn").forEach((b, i) => b.setAttribute("aria-pressed", String(i === state.qi)));
  document.querySelectorAll("#mode button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.m === state.mode));
    b.disabled = b.dataset.m === "vec" && !cur.preset;
  });
  document.getElementById("modeHint").textContent = cur.preset
    ? (state.mode === "kw" ? "数问题和卡片之间相同的词（去掉了平假名虚词）" : "分数是本地 embedding 模型算出的相似度，越接近 1 越相似")
    : "自己输入的问题只能「按字找」。「按意思找」要运行模型，这里用的是事先算好的分数";

  const sc = scores(cur);
  const order = sc.map((s, i) => ({ ...s, i })).sort((a, b) => b.v - a.v);
  const top3 = new Set(order.slice(0, 3).map(o => o.i));
  const ans = cur.preset ? cur.preset.answer : null;

  document.getElementById("cards").innerHTML = order.map((o, rank) => {
    const c = DATA.cards[o.i];
    const tags = (c.old ? '<span class="tag old">旧版</span>' : "") + (c.id === ans ? '<span class="tag ans">正确答案</span>' : "");
    return `<div class="card${top3.has(o.i) ? " top" : ""}"><div class="meta"><span class="rank">#${rank + 1}</span><span class="score">${o.label}</span></div>` +
      `<h5>${esc(c.doc)} &gt; ${esc(c.heading)}${tags}</h5><div class="body">${highlight(c.text, o.hits)}</div></div>`;
  }).join("");

  const ex = document.getElementById("explain");
  if (cur.preset) {
    const e = EXPLAIN[cur.qi];
    ex.innerHTML = `<p>${state.mode === "kw" ? e.kw : e.vec}</p><p><strong>这个例子说明了什么：</strong>${e.lesson}</p>`;
  } else {
    const best = order[0];
    ex.innerHTML = best.v === 0
      ? "<p>没有任何卡片和你的问题有共同的词，前 3 张是随便排的。这正是「按字找」的局限：换个说法就找不到。</p>"
      : `<p>和你的问题共同词最多的是「${esc(DATA.cards[best.i].heading)}」。看看前 3 张里有没有你想要的答案，再换个说法问一次对比。</p>`;
  }

  const picked = order.slice(0, 3).map((o, n) => {
    const c = DATA.cards[o.i];
    return `[資料${n + 1}] ${c.doc} > ${c.heading}（${c.updated} 更新）\n${c.text}`;
  }).join("\n\n");
  document.querySelector("#prompt code").textContent =
    `以下の社内資料だけを根拠に、質問に答えてください。\n資料に答えがなければ「社内資料に記載がありません」と答えてください。\n回答の各文に、根拠にした資料の番号を付けてください。\n\n${picked}\n\n質問: ${cur.q}`;
}

const qs = document.getElementById("qs");
DATA.questions.forEach((q, i) => {
  const b = document.createElement("button");
  b.className = "qbtn"; b.type = "button";
  b.innerHTML = `<small>Q${i + 1}</small>${esc(q.q)}`;
  b.addEventListener("click", () => { state.qi = i; render(); });
  qs.appendChild(b);
});
document.querySelectorAll("#mode button").forEach(b => b.addEventListener("click", () => { if (!b.disabled) { state.mode = b.dataset.m; render(); } }));
const go = () => { const v = document.getElementById("custom").value.trim(); if (v) { state.custom = v; state.qi = -1; render(); } };
document.getElementById("customGo").addEventListener("click", go);
document.getElementById("custom").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
render();
</script>
'''

out = HTML.replace("__CSS__", css + EXTRA).replace("__DATA__", json.dumps(data, ensure_ascii=False))
path = os.path.join(R, "tools/rag-intro.html")
open(path, "w", encoding="utf8").write(out)
print("wrote", path, os.path.getsize(path))
