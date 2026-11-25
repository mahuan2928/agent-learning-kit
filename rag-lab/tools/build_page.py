#!/usr/bin/env python3
"""RAG 设计实战 page generator. 代码块读真实源码, 数字读 results/experiments.json。
用法: python3 tools/build_page.py  → tools/rag-design-lab.html"""
import html, json, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = lambda f: open(os.path.join(R, f), encoding="utf8").read()
esc = lambda s: html.escape(s, quote=False)
X = json.load(open(os.path.join(R, "results/experiments.json"), encoding="utf8"))
pct = lambda x: f"{round(x * 100)}%"
CSS = src("tools/style.css") + r'''
.num{font-family:var(--f-mono);font-variant-numeric:tabular-nums;white-space:nowrap}
td.best{font-weight:700;color:var(--ok)}
.map2 td:first-child{font-family:var(--f-mono);font-size:12.5px;white-space:nowrap}
.stat{display:flex;flex-wrap:wrap;gap:1px;background:var(--rule);border:1px solid var(--rule);margin:0 0 20px;max-width:min(100%,980px)}
.stat div{flex:1 1 150px;background:var(--surface);padding:12px 14px}
.stat b{display:block;font-family:var(--f-display);font-size:26px;line-height:1.1;color:var(--ink);font-variant-numeric:tabular-nums}
.stat span{font-size:13px;color:var(--muted)}
'''

def code(path, open_=False, badge="源码", note=""):
    text = src(path).rstrip("\n")
    lines = "".join(f'<span class="l"><i>{n}</i>{esc(l) or " "}</span>' for n, l in enumerate(text.split("\n"), 1))
    pre = f'<pre class="code"><code>{lines}</code></pre>'
    n = text.count("\n") + 1
    head = f'<div class="fh"><span class="badge {"new" if open_ else "mod"}">{badge}</span><b>{esc(path)}</b><span class="meta">{note or f"{n} 行"}</span></div>'
    body = pre if open_ else f'<details class="full"><summary>展开 {esc(path)}（{n} 行）</summary>{pre}</details>'
    return f'<div class="file">{head}{body}</div>'

def table(head, rows, best_cols=(), cls=""):
    """rows: list of lists of str; best_cols: column indexes where the max numeric value is highlighted"""
    best = {}
    for c in best_cols:
        vals = [float(r[c].rstrip("%")) for r in rows]
        best[c] = max(vals)
    th = "".join(f"<th>{h}</th>" for h in head)
    tr = ""
    for r in rows:
        tds = ""
        for i, v in enumerate(r):
            hl = i in best and float(v.rstrip("%")) == best[i]
            tds += f'<td class="{"num " if i else ""}{"best" if hl else ""}">{v}</td>'
        tr += f"<tr>{tds}</tr>"
    return f'<div class="tw {cls}"><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'

def flow(spec):
    out = []
    for t in spec:
        if t == ">": out.append('<span class="ar">→</span>')
        elif t == "/": out.append('<span class="br"></span>')
        elif t[0] == "side": out.append(f'<span class="side">{t[1]}</span>')
        else:
            k, txt, *sm = t
            out.append(f'<span class="n {k}">{txt}' + (f"<small>{sm[0]}</small>" if sm else "") + "</span>")
    return f'<div class="flow">{"".join(out)}</div>'

KEY = '<div class="key"><span><i class="llm"></i>模型调用 (API)</span><span><i class="code"></i>代码 / 本地模型 (免费)</span><span><i class="human"></i>兜底</span></div>'
def run(cmd, see=""):
    s = f'<div class="run"><div class="run-h">跑这个</div><div class="run-b"><pre><code>{cmd}</code></pre></div></div>'
    return s + (f'<div class="see"><span class="lbl">实测结果的读法</span>{see}</div>' if see else "")
def brk(body): return f'<div class="break"><span class="lbl">故意搞坏</span>{body}</div>'
def note(lbl, body): return f'<div class="note"><span class="lbl">{lbl}</span>{body}</div>'
def qa(pitch, pairs):
    dl = "".join(f"<dt>{q}</dt><dd>{a}</dd>" for q, a in pairs)
    return f'<div class="qa"><span class="lbl">面试怎么讲</span><div class="body"><p><strong>30 秒版：</strong>{pitch}</p><dl>{dl}</dl></div></div>'
def stage(id_, num, title, ref, goal, body):
    return (f'<section class="stage" id="{id_}"><div class="stage-head"><span class="stage-num">{num}</span><h2>{title}</h2></div>'
            f'<div class="goal"><span class="lbl">这一章回答</span><p>{goal}</p></div><p class="ref">对应框架文档 <b>{ref}</b></p>{body}</section>')
def rrow(label, r): return [label, pct(r["recall1"]), pct(r["recall3"]), pct(r["recall5"]), f'{r["mrr"]:.2f}', ", ".join(r["missed"]) or "—"]
RH = ["配置", "R@1", "R@3", "R@5", "MRR", "前 5 仍未命中"]

E1, E2, E3, E4, E5, E6 = (X[k] for k in ["E1", "E2", "E3", "E4", "E5", "E6"])
P = []
P.append(f'''<title>RAG 设计实战</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>{CSS}</style>
<div class="shell">
<header class="masthead">
  <div class="stamp"><span>RAG Lab</span><span>配套 <b>LangGraph RAG 框架</b></span><span>14 份规程 · 46 道评测题</span><span>本地 embedding + 重排</span></div>
  <h1>RAG 设计实战</h1>
  <p class="dek">把你那份《基于 LangGraph 的 RAG 知识问答 Agent》逐章做成能跑的代码。语料是一家连锁餐饮公司的内部规程，带权限、带新旧版本，也有资料里根本没有答案的问题。<em>每个设计决策都配一个实测数字</em>：检索部分全部在本机离线跑，不花 API 费用。</p>
</header>
<div class="layout">
<nav class="rail" aria-label="章节">
  <h2>章节</h2>
  <ol>
    <li><a href="#setup"><span>00</span><span>准备与对照</span></a></li>
    <li><a href="#s1"><span>01</span><span>语料与元数据</span></a></li>
    <li><a href="#s2"><span>02</span><span>切块</span></a></li>
    <li><a href="#s3"><span>03</span><span>召回与分词</span></a></li>
    <li><a href="#s4"><span>04</span><span>重排</span></a></li>
    <li><a href="#s5"><span>05</span><span>权限过滤</span></a></li>
    <li><a href="#s6"><span>06</span><span>新旧版本</span></a></li>
    <li><a href="#s7"><span>07</span><span>拒答阈值</span></a></li>
    <li><a href="#s8"><span>08</span><span>状态图</span></a></li>
    <li><a href="#s9"><span>09</span><span>端到端评测</span></a></li>
    <li><a href="#prod"><span>★</span><span>决策清单与面试</span></a></li>
  </ol>
</nav>
<main>
''')

P.append(f'''<section class="setup" id="setup">
  <h2>准备 · 10 分钟（首次下载模型）</h2>
  <pre><code>cd ~/Downloads/claude/rag-lab
npm install
npm test           # 离线测试 15 项。首次运行会把两个本地模型下载到 .models/ (约 700MB)
npm run exp        # 实验 E1–E6, 全部离线, 结果写到 results/experiments.json
npm run smoke      # 假 API + 真检索, 把状态图的 8 条路径走一遍

export ANTHROPIC_API_KEY=sk-ant-...
npm run ask -- --role staff "残業代ってどうやって計算されるの？"
npm run e2e        # 46 题端到端评测, 约 $1</code></pre>
  <div class="stat">
    <div><b>14</b><span>份规程（4 个权限级别、1 组新旧版本）</span></div>
    <div><b>46</b><span>道评测题，7 种题型</span></div>
    <div><b>{pct(E3["rerank"]["recall1"])}</b><span>最终检索 R@1（加重排后）</span></div>
    <div><b>{E4["leakQuestions"]}/{E4["total"]}</b><span>题在不做权限过滤时会搜到越权文档</span></div>
  </div>

  <h3>和你的框架文档逐章对照</h3>
  <div class="tw map2"><table>
    <thead><tr><th>框架文档</th><th>这里的实现</th><th>章节</th></tr></thead>
    <tbody>
      <tr><td>§2 离线索引管线</td><td><code>corpus.ts</code> 元数据 · <code>chunkers.ts</code> 5 种切块 · <code>models.ts</code> 本地 embedding</td><td><a href="#s1">01</a> <a href="#s2">02</a></td></tr>
      <tr><td>§4.1 混合检索 / Rerank / 权限 / 时效</td><td><code>bm25.ts</code> · <code>retrieve.ts</code>（RRF、pre/post filter、dropSuperseded、cross-encoder）</td><td><a href="#s3">03</a>–<a href="#s6">06</a></td></tr>
      <tr><td>§3 StateGraph（route → rewrite → retrieve → grade → generate → verify → fallback）</td><td><code>graph.ts</code>（接口照 LangGraph 起名）· <code>rag-graph.ts</code></td><td><a href="#s8">08</a></td></tr>
      <tr><td>§3.4 条件边阈值</td><td>grade 阈值由实验 E6 的数据定出来</td><td><a href="#s7">07</a></td></tr>
      <tr><td>§4.2 生成防幻觉 · 结构化引用</td><td>检索结果作为 <code>search_result</code> 块传入，API 返回原生引用</td><td><a href="#s8">08</a></td></tr>
      <tr><td>§4.3 守护与可信度</td><td>verify：代码查引用覆盖率 + Haiku 查引用是否支持原句</td><td><a href="#s8">08</a></td></tr>
      <tr><td>§7 评估</td><td><code>evalset.ts</code> 检索指标 · <code>experiments.ts</code> · <code>eval-e2e.ts</code> 端到端 + 消融</td><td><a href="#s2">02</a>–<a href="#s9">09</a></td></tr>
      <tr><td>§10 决策清单</td><td>每一项在这个 lab 里的选择和依据</td><td><a href="#prod">★</a></td></tr>
    </tbody>
  </table></div>
  <p style="max-width:none">没做的部分：§5 多轮记忆（这里每个问题独立，加 Checkpointer 的方式见 Harness 那篇 Stage 09）、§6 人工介入（fallback 就是接入点）、接入层 SSE。</p>
</section>
''')

P.append(stage("s1", "Chapter 01", "语料与元数据：先把「谁能看、哪版有效」写进数据",
  "元数据要放哪些字段？为什么在切块之前就要定？", "§2 Load / 元数据",
  "<p>14 份规程是虚构的「サンプルダイニング」内部资料，刻意埋了真实知识库里常见的四种麻烦：</p>"
  "<ul><li><strong>权限分级</strong>：人事评价制度和给与表只有 <code>hr</code> 能看，店长手册和店长会议记录只有 <code>manager</code> / <code>hq</code> 能看。</li>"
  "<li><strong>新旧版本</strong>：经费精算规程有 2024 版和 2026 版，交通费上限、申请期限、领收书规定都不一样。</li>"
  "<li><strong>相似条目</strong>：15 个 POS 错误码，好几个都是「通信断」。</li>"
  "<li><strong>长 FAQ</strong>：一个小节里塞了 6 组口语化的 Q&amp;A，最容易被切坏，也最容易抢走检索结果。</li></ul>"
  "<p>每份文档开头的 front matter 就是元数据，切块时会原样带到每一块上。<strong>检索阶段要用的过滤条件（权限、版本），必须在索引时就存在</strong>，事后补要重建索引。</p>"
  + code("corpus/D03_経費精算規程_2026.md", open_=True, badge="样例", note="supersedes: D02")
  + code("src/corpus.ts")
  + note("评测集怎么标", "<p>46 道题标的不是「哪个 chunk id」，而是<strong>答案所在的原文片段</strong>（span）。只要某块包含这段原文就算命中。这样同一套标注能评任何切块策略：切法一变 chunk id 全变，但原文不变。题型分 7 种：编号（keyword）、换说法（paraphrase）、表格、新旧版本、权限、无答案、多跳。</p>")
  + code("src/evalset.ts")))

e1rows = []
for k in ["fixed-200", "fixed-200-o50", "section", "section+ctx", "section-300"]:
    r = E1[k]; e1rows.append([f'{k}（{r["chunks"]} 块，平均 {r["avgLen"]} 字）', pct(r["recall1"]), pct(r["recall3"]), pct(r["recall5"]), f'{r["mrr"]:.2f}', ", ".join(r["missed"]) or "—"])
P.append(stage("s2", "Chapter 02", "切块：没有通用最优，只有在你的数据上测出来的最优",
  "按字数切还是按标题切？要不要重叠？标题要不要放进检索文本？", "§2 Chunk",
  "<p>五种策略，同一个混合检索、同一套 38 道有答案的题：</p>"
  + table(["策略", "R@1", "R@3", "R@5", "MRR", "前 5 仍未命中"], e1rows, best_cols=(1, 2, 3, 4))
  + "<p><strong>读法</strong>：</p><ul>"
  "<li><code>fixed-200</code> 漏掉了 T1（有給 1 年半）。原因是 200 字一刀把表头和表行切开了，离线测试里专门有一条「反例」检查这件事。加上 50 字重叠就救回来了。</li>"
  f"<li>这批文档比较短，<code>fixed-200-o50</code> 的 R@1 反而最高（{pct(E1['fixed-200-o50']['recall1'])}）。<strong>这不说明固定切块更好</strong>：它的块平均 {E1['fixed-200-o50']['avgLen']} 字，接近一个完整条款，相当于「碰巧切对了」。规程一长，或者表格跨过 200 字，它就会重现 T1 的问题。</li>"
  "<li><code>section-300</code>（按小节切，长小节按行再切，Q/A 和表格不拆开）是本 lab 后面默认用的策略：边界永远落在语义边界上，块大小可控，引用时能显示「文書名 > 見出し」。</li></ul>"
  + code("src/chunkers.ts")
  + run("npm run exp -- E1")
  + brk("<p>把 <code>splitSection</code> 里「Q: + A: 两行不拆开」的条件删掉，再跑 E1。FAQ 类问题（F 系列）会开始出现「搜到了问题行，答案在下一块」的情况。<strong>切块边界决定了检索的上限，后面的重排再强也救不回被切散的答案。</strong></p>")
  + qa("切块我不拍脑袋定，先标一个小评测集，用 recall@k 比较几种切法。经验上按标题切、超长小节再按语义单位细分、标题作为上下文前缀，这种做法最稳；但在具体数据上要测。我在实验里看到固定 200 字会把表头和表行切开，导致表格题漏召回，加重叠可以缓解，按结构切能根治。",
       [("块大小怎么定？", "看两个约束：答案通常有多长（这里一个条款 50–150 字），以及生成时能塞几块（top 5 × 300 字，对模型来说很轻松）。太大了检索不准、引用不精确；太小了会把一句话的条件和结论拆开。"),
        ("contextual chunking 有用吗？", f"在这个语料上没有测出提升：给检索文本加上「文書名 &gt; 見出し」前缀后，R@1 都是 {pct(E1['section+ctx']['recall1'])}，MRR {E1['section']['mrr']:.2f} → {E1['section+ctx']['mrr']:.2f}。原因是这些规程的正文本身就重复了标题里的关键词。它的价值在「正文不提主题」的文档上（比如表格、「前項の場合は…」这类条款）。我保留它，主要是因为引用时要显示出处标题；要不要加进检索文本，同样用评测集决定。")])))

e2rows = []
lab = {"bm25-raw": "BM25（字符 bigram）", "bm25": "BM25（去掉平假名 bigram）", "vector": "向量（e5-small）", "hybrid-raw": "混合 RRF（BM25 未处理）", "hybrid": "混合 RRF（BM25 去平假名）"}
for k in ["bm25-raw", "bm25", "vector", "hybrid-raw", "hybrid"]:
    r = E2[k]; bt = r["byTypeRecall3"]
    e2rows.append([lab[k], pct(r["recall1"]), pct(r["recall5"]), f'{r["mrr"]:.2f}', pct(bt["keyword"]), pct(bt["paraphrase"]), pct(bt["table"])])
P.append(stage("s3", "Chapter 03", "召回：混合检索不是免费午餐，日语分词决定成败",
  "向量、BM25、混合各自擅长什么？混合一定更好吗？", "§4.1 混合检索",
  "<p>在 <code>section+ctx</code> 切法上比较 5 种召回方式。后三列是按题型拆开的 R@3：</p>"
  + table(["召回方式", "R@1", "R@5", "MRR", "编号题 R@3", "换说法 R@3", "表格 R@3"], e2rows, best_cols=(1, 2, 3, 4, 5, 6))
  + "<p><strong>这张表里有两个反直觉的结果，都是真实知识库里会遇到的：</strong></p><ol>"
  f"<li><strong>混合检索没有超过纯向量。</strong>向量 R@5 是 {pct(E2['vector']['recall5'])}，混合是 {pct(E2['hybrid']['recall5'])}。RRF 是等权融合：BM25 排错的时候，会把向量排对的结果往下拉。在一个 50 块的小语料上，多语种 embedding 已经足够好，BM25 的增益（编号精确匹配）体现不出来，它的噪声反而体现出来了。</li>"
  f"<li><strong>日语分词决定了 BM25 是帮忙还是添乱。</strong>字符 bigram 会把「どうやって」「されるの」也当成词。口语问题（「残業代ってどうやって計算されるの？」）就会去匹配同样口语化的 FAQ 行。只做一件事，去掉纯平假名的 bigram，混合检索的 R@5 就从 {pct(E2['hybrid-raw']['recall5'])} 升到 {pct(E2['hybrid']['recall5'])}。正式做法是用 Sudachi / MeCab 做形态素解析，只保留内容词。</li></ol>"
  "<p>那为什么还用混合？因为语料一大，向量检索容易在<strong>编号、型号、人名、条款号</strong>这类「字面必须一致」的查询上失手（E-221 和 E-212 只差一个数字，描述又都是「通信断」），这时 BM25 是保底。这个 lab 的语料太小，没能测出这一点，所以下一步要看的是重排（第 04 章），它能把两路召回的优点都留下。</p>"
  + code("src/bm25.ts") + code("src/retrieve.ts") + code("src/models.ts")
  + run("npm run exp -- E2")
  + brk("<p>把 <code>models.ts</code> 里 embedding 的前缀 <code>`${kind}: ${t}`</code> 改成直接用 <code>t</code>（漏掉 e5 要求的 <code>query: </code> / <code>passage: </code> 前缀），删掉 <code>.cache/</code> 再跑 E2。向量检索会明显下降。<strong>换 embedding 模型一定要读它的使用说明，前缀、归一化、最大长度都会影响结果。</strong></p>")
  + qa("混合检索我会做，但不会默认它更好。我实测过：在小语料上，多语种向量检索已经很强，等权 RRF 反而被 BM25 的噪声拖累；BM25 的质量又取决于日语分词，字符 bigram 会让口语里的虚词去匹配 FAQ。所以我的做法是：混合召回求覆盖，后面接重排求精度，阈值和权重用评测集定。",
       [("RRF 和分数加权融合怎么选？", "BM25 分数和余弦相似度量纲不同，直接加权要先归一化，而且权重对数据分布敏感。RRF 只看名次，不用调参，是更稳的默认值。如果有足够的评测数据，可以给两路加权（比如向量 2：BM25 1），用评测集选权重。"),
        ("日语检索还有什么坑？", "全角半角（NFKC 归一化）、长音和片假名表记揺れ（サーバー / サーバ）、和製英語与外来语（スマホ / スマートフォン）、敬语带来的长问句。前两个用归一化，后两个靠向量检索或查询改写（第 08 章的 rewrite 节点）。")])))

P.append(stage("s4", "Chapter 04", "重排：性价比最高的一步",
  "召回之后为什么还要重排？代价是什么？", "§4.1 Rerank",
  "<p>召回（bi-encoder）把问题和文档各自编码再比相似度，快但粗。重排（cross-encoder）把问题和文档拼在一起逐对打分，慢但准。标准做法是召回 20 条，重排后取前 5。</p>"
  + table(RH, [rrow("混合检索", E3["hybrid"]), rrow("混合 + 重排（bge-reranker-v2-m3）", E3["rerank"])], best_cols=(1, 2, 3, 4))
  + f"<p>R@1 从 {pct(E3['hybrid']['recall1'])} 提升到 {pct(E3['rerank']['recall1'])}，前 3 已经全部命中。混合检索漏掉的 P6（家族割引）和 P14（スマホ紛失）都被救了回来。代价是延迟：在本机 CPU 上，每个问题平均 {E3['rerank']['msPerQuery'] / 1000:.1f} 秒（含首次加载模型的时间），生产环境上 GPU 或换托管重排服务。</p>"
  "<p>重排分数还有第二个用途：它比召回分数更可比，可以拿来判断「搜到的东西到底相不相关」。第 07 章会用它来定拒答阈值。</p>"
  + run("npm run exp -- E3")
  + brk("<p>在 <code>retrieve.ts</code> 里把重排输入从 <code>`${docTitle} ${heading}\\n${text}`</code> 改成只给 <code>text</code>，再跑 E3。标题里的「時間外労働と手当」「従業員割引」都是强信号，去掉后 R@1 会掉。<strong>喂给重排模型的文本也是一个设计决策。</strong></p>")
  + qa("重排是 RAG 里性价比最高的一步。我实测 R@1 从 76% 提升到 92%，召回阶段漏掉的都救回来了。召回负责「不漏」，重排负责「排准」，两者分工。代价是延迟，所以只对召回的前 20 条做，并且重排分数还能顺便当相关性信号用。",
       [("重排用 LLM 还是 cross-encoder？", "cross-encoder 便宜、快、确定，分数可以直接设阈值；LLM 重排更懂复杂问题，但贵、慢、分数不稳定。我的默认是 cross-encoder，只有评测证明它在某类问题上不够时，才对那一类加 LLM 判断。"),
        ("前 20 条和前 5 条怎么定？", "召回的 k 看 R@k 曲线：R@20 接近 100% 就够了。生成的 k 看上下文成本和干扰：块越多，模型被无关内容带偏的概率越高。这里 R@3 已经 100%，取 5 留了余量。")])))

leak_list = "".join(f"<li><code>{k}</code> → {', '.join(v)}</li>" for k, v in list(E4["leaks"].items())[:6])
P.append(stage("s5", "Chapter 05", "权限过滤：检索阶段就要过滤，不能指望模型不说",
  "权限过滤放在哪一步？先过滤还是后过滤？", "§4.1 权限过滤",
  f"<p>不做任何过滤时，<strong>{E4['leakQuestions']}/{E4['total']} 题</strong>的前 5 条结果里出现了提问者无权查看的块。比如：</p><ul>{leak_list}</ul>"
  "<p>这些块一旦进了生成的上下文，就只能指望模型「不说出来」。这不是权限控制，这是祈祷。所以过滤必须在检索阶段完成，<strong>无权查看的块根本不进入候选集</strong>。</p>"
  + table(["过滤位置", "R@1", "R@3", "R@5", "MRR", "平均返回块数"],
          [["pre-filter（先过滤再排序）", pct(E4["pre"]["recall1"]), pct(E4["pre"]["recall3"]), pct(E4["pre"]["recall5"]), f'{E4["pre"]["mrr"]:.2f}', f'{E4["pre"]["avgResults"]:.1f}'],
           ["post-filter（先取 top 5 再过滤）", pct(E4["post"]["recall1"]), pct(E4["post"]["recall3"]), pct(E4["post"]["recall5"]), f'{E4["post"]["mrr"]:.2f}', f'{E4["post"]["avgResults"]:.1f}']])
  + f"<p>两种做法的召回一样，区别在返回块数：post-filter 平均只剩 {E4['post']['avgResults']:.1f} 块，因为前 5 条里被过滤掉的位置没有人补上。在这个小语料上差别不大；到了几十万块的库里，一个普通员工问「给与」相关的问题，前 5 条可能全是人事部的文档，post-filter 会直接返回空。向量数据库一般都支持带元数据过滤的检索（metadata filter），应该用它做 pre-filter。</p>"
  + run("npm run exp -- E4")
  + brk("<p>在 <code>rag-graph.ts</code> 的 retrieve 节点里去掉 <code>role: s.role</code>，用 manager 身份问「店長の基本給はいくら？」。检索结果里会出现 D09（给与表），模型很可能直接把金额说出来。<strong>端到端评测的「越权引用」指标就是为了抓这个。</strong></p>")
  + qa("权限过滤我放在检索阶段，用元数据做 pre-filter，无权查看的块根本不进候选集，更不会进模型上下文。我实测不过滤时，46 题里有 11 题会搜到越权文档。另外不能用「先取 top k 再过滤」，那样结果会凭空变少，大库里甚至变成空结果。",
       [("权限信息从哪来？", "索引时从源系统同步 ACL（文档所在的空间、文件夹权限、部门），写进每一块的元数据；查询时从登录身份拿角色。权限变更要触发重新索引元数据，这一点经常被忘。"),
        ("如果用户通过提问「套」出越权信息呢？", "因为越权的块根本不在上下文里，模型无从说起。最多只能根据有权限的资料推测，这一层由 verify 节点的引用核验兜住：没有出处的论断会被判为不可信。")])))

e5txt = "".join(f"<li><code>{d['id']}</code> 前 3：{' '.join(d['top3'])}</li>" for d in E5["none"])
P.append(stage("s6", "Chapter 06", "新旧版本：旧规程排在新规程前面，而且一次都没错过",
  "规程更新了，旧版要不要从索引里删？怎么让检索只返回有效版本？", "§4.1 时效过滤",
  f"<p>三道经费题（交通费上限、申请期限、领收书），不做处理时<strong>旧版 3 题全部排在新版前面</strong>：</p><ul>{e5txt}</ul>"
  "<p>原因很简单：两版的措辞几乎一样，旧版的说法（「原本を郵送」「翌月5日」）甚至和口语问题更接近。相似度无法区分「哪一版有效」，这只能靠元数据。</p>"
  "<p>这个 lab 用了两道保险：<strong>检索时去掉 <code>superseded_by</code> 不为空的文档</strong>（E5 里旧版命中降为 0）；<strong>生成时每个检索结果的标题都带上更新日期</strong>，并在指令里写明「新旧资料冲突时以更新日较新的为准」，防止元数据漏标。</p>"
  "<p>旧版本身不删：审计时要能查「当时的规定是什么」。正确的做法是保留在库里，但默认检索排除；需要查历史时显式带上参数。</p>"
  + run("npm run exp -- E5")
  + brk("<p>端到端评测加上 <code>--keep-stale</code> 跑一次（<code>npm run e2e -- --keep-stale</code>）。看「旧版引用」指标：没了检索层的过滤，只剩生成指令里那句「以更新日较新的为准」，模型能拦住多少？<strong>两道保险分别管多少，用这个消融实验量出来。</strong></p>")
  + qa("时效问题我用元数据解决，不靠相似度。我实测过新旧两版规程措辞几乎一样，旧版 3 题全排在前面。做法是索引里记录取代关系，检索默认排除已被取代的版本；生成时把更新日期放进出处标题，并要求冲突时以新版为准，作为第二道保险。旧版保留在库里供审计查询。",
       [("没有明确的取代关系怎么办？", "很多规程只是「更新日不同」，没有人标注取代关系。可以按文档系列（同名、同部门）只保留最新一版；或者在重排后对同一系列的多个版本降权较旧的。更根本的办法是在源头的文档管理流程里加「废止」状态。"),
        ("会议记录这种时效很强的文档呢？", "按问题类型区分：问「现行规定」时排除过期文档，问「上次会议决定了什么」时按日期倒序。这一步可以放在 route 或 rewrite 节点里识别。")])))

e6rows = "".join(f'<tr><td class="num">{r["top1"]:.2f}</td><td>{"<strong>无答案</strong>" if not r["answerable"] else "有答案"}</td><td>{r["id"]}（{r["type"]}）</td></tr>' for r in E6["rows"] if r["top1"] < 0.5)
P.append(stage("s7", "Chapter 07", "拒答阈值：分数能筛掉一部分，但不能直接拿来拒答",
  "资料里没有答案时，怎么让系统说「不知道」而不是硬答？阈值怎么定？", "§3.4 条件边 · grade",
  "<p>把每道题重排后第一名的分数从高到低排开。理想情况是「有答案」的都在上面、「无答案」的都在下面，中间画一条线就行。实际是这样的（只列出分数低于 0.5 的部分）：</p>"
  f'<div class="tw"><table><thead><tr><th>top 1 分数</th><th>资料里有没有答案</th><th>题</th></tr></thead><tbody>{e6rows}</tbody></table></div>'
  f"<p>最好的单一阈值是 <code>{E6['threshold']:.2f}</code>，仍然会<strong>误拒 {len(E6['falseRefuse'])} 题</strong>（{', '.join(E6['falseRefuse'])}）、<strong>误答 {len(E6['falseAnswer'])} 题</strong>（{', '.join(E6['falseAnswer'])}）。误拒的是口语问法（「家族と食べに行くと安くなりますか」），误答的是「问了一个相关领域但资料没写的问题」（育児休業、店长的基本给）。</p>"
  "<p>所以状态图里 grade 节点的设计是：<strong>分数低于阈值时不直接拒答，先改写查询再搜一次</strong>；重搜后的重排分数取「原问法和各改写查询中的最高分」，这样口语问题就有机会被救回来。还不够才走 fallback。分数在阈值以上但资料其实不包含答案的情况，交给生成指令（「資料に答えがなければ…とだけ答える」）和 verify 节点处理。这就是你框架里的 CRAG 回路，<strong>阈值不是拍出来的，是从这张表里定的</strong>（代码里取 -4）。</p>"
  + run("npm run exp -- E6")
  + qa("拒答我分三层做：检索分数低于阈值时先改写重搜，不直接拒答；分数够但资料没写的，由生成指令要求明确说「资料里没有」；最后 verify 节点核验引用，不可信的走兜底。阈值是用评测集定的：我把每道题的重排 top1 分数排开看分布，发现单一阈值总会有误拒和误答，所以才设计成多层。",
       [("为什么 grade 不用 LLM 打分？", "重排分数是免费的（本地模型），而且确定、可复现，阈值能用数据定。LLM 打分要花一次调用、分数会漂。只有当分数分布真的分不开时，才值得在模糊区间里加一次 LLM 判断。"),
        ("「宁可不答」和「尽量答」怎么权衡？", "这是业务决策，不是技术决策：员工手册问答，误拒的代价是员工去问人事；医疗、法务问答，误答的代价可能是事故。阈值往哪边偏，要和客户一起看这张表决定，并写进验收标准。")])))

P.append(stage("s8", "Chapter 08", "状态图：把检索、判断、生成、核验接成一条有回路的流水线",
  "框架里的 StateGraph 落到代码是什么样？每个节点用什么做判断？", "§3 · §4.2 · §4.3",
  flow([("llm", "route", "Haiku · 3 类"), ">", ("llm", "rewrite", "Haiku · 口语→规程用语"), ">", ("code", "retrieve", "混合 + 权限 + 去旧版 + 重排"), ">", ("code", "grade", "分数 ≥ -4 ?"), ">", ("llm", "generate", "Opus · search_result 引用"), ">", ("code", "verify", "覆盖率"), ("llm", "", "Haiku 支持度"), "/",
        ("side", "grade 低分 →"), ("n", "rewrite 重搜 1 次"), ("side", "→ 仍低 →"), ("human", "fallback"),
        ("side", "　verify 不可信 →"), ("n", "重新生成 1 次"), ("side", "→ 仍不可信 →"), ("human", "fallback"), "/",
        ("side", "route = reject（注入、打听他人隐私）→"), ("human", "fallback"), ("side", "　chitchat →"), ("llm", "generate（不检索）")])
  + KEY
  + "<p>和框架文档相比，这一版做了几个具体选择：</p><ul>"
  "<li><strong>能不调模型的节点都不调。</strong>retrieve 和 grade 全部在本地完成：召回、过滤、重排、阈值判断都不花 API 费用。只有 route、rewrite、generate、verify 四个节点调模型，其中三个用 Haiku。</li>"
  "<li><strong>生成用 API 的原生引用。</strong>每个检索块作为一个 <code>search_result</code> 块传入（<code>source</code> = chunk id，<code>title</code> 带更新日期），模型返回的每段文字自带引用，指向具体的块。不用在 prompt 里让模型自己写 <code>[D01#3]</code>，也就不存在「编造一个不存在的出处」。</li>"
  "<li><strong>verify 分两层。</strong>代码先算引用覆盖率（有多少句话带了出处）；再让 Haiku 逐条检查「引用的原文是否支持这句话」。这一层抓的是「出处是真的，但话说过头了」，比如把「週30時間以上のアルバイト」说成「アルバイトも」。</li>"
  "<li><strong>每个回路都有上限。</strong>改写重试 1 次、重新生成 1 次，整张图最多 20 步。条件边里的计数写错了，也不会死循环。</li></ul>"
  + code("src/graph.ts", open_=True, badge="图运行器")
  + code("src/rag-graph.ts", open_=True, badge="状态图")
  + code("src/ask.ts")
  + run('npm run smoke      # 不花钱: 8 条路径的接线测试\nnpm run ask -- --role staff "家族と食べに行くと安くなりますか？"',
        "<p><code>ask</code> 会逐个打印走过的节点和它更新了什么：rewrite 生成的查询（应该出现「従業員割引」一类的规程用语）、retrieve 的前 5 块和分数、verify 的覆盖率和支持度，最后是带出处的回答和本次的费用明细。</p>")
  + brk("<p>把 rewrite 节点 prompt 里「例: 残業代→時間外労働手当」那一句删掉，再问 P6（家族割引）和 P1（残業代）。看 rewrite 生成的查询还是不是规程用语，grade 会不会因此走到 fallback。<strong>改写 prompt 里的一个例子，可能就决定了一类问题答不答得出来。</strong></p>"
        "<p>把 <code>minConfidence</code> 调到 1.0：几乎所有回答都会被打回重新生成，费用翻倍。调到 0：verify 形同虚设。这个值也应该用评测集定。</p>")
  + qa("我把 RAG 建模成状态图：路由、改写、检索、评分、生成、核验、兜底，评分和核验两处有回路，对应 CRAG 的「检索不好就纠正检索，生成不可信就纠正生成」。能用代码判断的节点不调模型，检索和评分全在本地；生成用 API 原生引用，出处不可能是编造的；核验再查引用是否真的支持原句。每个回路都有次数上限。",
       [("为什么自己写图运行器，不直接用 LangGraph？", "为了学习时每一行都看得见。接口是照 LangGraph 起名的（addNode / addEdge / addConditionalEdges / invoke），搬过去是一对一的。生产里用 LangGraph 能直接拿到 checkpointer、interrupt（人工介入）和 LangSmith 追踪。"),
        ("rewrite 会不会把问题改坏？", "会。所以检索时原问题和改写后的查询都搜，合并后再重排，重排分数取最高。改写只能「增加」候选，不会让原问题能搜到的东西消失。"),
        ("多轮对话怎么办？", "在 rewrite 节点里把历史对话也传进去，做指代消解（「那个呢？」→「交通費の上限は？」）；状态用 checkpointer 按 thread_id 存。这个 lab 每个问题独立，没做这一层。")])))

P.append(stage("s9", "Chapter 09", "端到端评测：每个组件值多少，用消融实验说话",
  "整条链路的正确率是多少？去掉某个组件会掉多少？", "§7 评估",
  "<p>前面的实验只评检索。端到端评测把 46 道题全部走一遍状态图，按题型统计：</p><ul>"
  "<li><strong>有答案的题</strong>：没有拒答，并且 Haiku 判定回答包含期待的要点，才算正确。</li>"
  "<li><strong>没有答案的题</strong>（资料里没有，或者提问者无权查看）：拒答或者走到 fallback，才算正确。</li>"
  "<li><strong>另外单独统计</strong>：越权引用（应为 0）、引用了旧版、fallback 率、平均延迟、总费用。</li></ul>"
  "<p>真正有用的是<strong>消融实验</strong>：每次关掉一个组件，看哪类题掉了多少。面试被问「为什么要加重排」时，拿出这张对比表比任何解释都有说服力。</p>"
  + code("src/eval-e2e.ts")
  + run("npm run e2e                    # 完整配置\nnpm run e2e -- --no-rewrite     # 去掉改写: 看 paraphrase 和 noanswer\nnpm run e2e -- --no-rerank      # 去掉重排: grade 也随之失效\nnpm run e2e -- --no-verify      # 去掉核验\nnpm run e2e -- --keep-stale     # 不排除旧版: 看「旧版引用」",
        "<p>每次的结果写到 <code>results/e2e-&lt;配置&gt;.json</code>，里面有每道题走过的路径和回答，打开就能看到某道题错在哪个节点。完整配置一次大约 $1（主要是 Opus 生成），五种配置全跑约 $4。</p>")
  + note("还没跑", "<p>这一章的数字要用真实 API 跑出来，本机没有 API key，所以<strong>这里没有放结果</strong>，也没有编数字。跑完之后把五个 JSON 的 summary 放在一起，就是你自己的消融对比表。</p>")
  + qa("评测分两层：检索层用标注了原文片段的评测集算 recall@k 和 MRR，完全离线；端到端用状态图把每道题跑一遍，按题型统计正确率、越权引用、旧版引用和兜底率。每加一个组件就做一次消融实验，证明它值得它带来的延迟和成本。",
       [("LLM 当裁判可靠吗？", "这里的裁判只做一件很窄的事：回答是否包含一个给定的要点。比打 1 到 10 分稳定得多。上线前要抽 30 到 50 条人工复核，算出裁判和人的一致率；一致率不够的题型改成规则判分。"),
        ("评测集从哪来？", "上线前：每类问题手写 5 到 10 条，刻意包含新旧版本、权限、没有答案的题。上线后：从 fallback 和用户差评里挑，人工标注后补进评测集。评测集要按题型统计，总分会掩盖某一类的退化。")])))

P.append(f'''<section class="stage" id="prod">
  <div class="stage-head"><span class="stage-num">★</span><h2>决策清单与面试：把框架 §10 填上答案</h2></div>
  <div class="goal"><span class="lbl">这一章回答</span><p>框架文档 §10 的每个「开工前要拍板」的问题，在这个 lab 里选了什么、依据是什么。面试里被问 RAG system design 时，按这个顺序讲。</p></div>
  <div class="tw"><table>
    <thead><tr><th>决策</th><th>这里的选择</th><th>依据</th></tr></thead>
    <tbody>
      <tr><td>数据源与更新频率</td><td>Markdown + front matter，全量重建</td><td>14 份规程，重建只要几秒。生产里按源系统的更新事件做增量</td></tr>
      <tr><td>Embedding 与向量库</td><td>multilingual-e5-small（本地）· 内存</td><td>零成本、可离线复现。模型名写进缓存键，换模型等于重建索引</td></tr>
      <tr><td>切块</td><td>按小节，长小节按行细分（≤300 字），Q/A 和表格不拆</td><td>E1：边界落在语义单位上，避免表格被切开</td></tr>
      <tr><td>召回</td><td>BM25（去平假名）+ 向量，RRF 融合</td><td>E2：小语料上向量已够强，混合用来给编号类查询保底；分词质量是前提</td></tr>
      <tr><td>重排</td><td>bge-reranker-v2-m3，前 20 → 前 5</td><td>E3：R@1 {pct(E3["hybrid"]["recall1"])} → {pct(E3["rerank"]["recall1"])}</td></tr>
      <tr><td>权限隔离</td><td>元数据 ACL，检索前过滤</td><td>E4：不过滤时 {E4["leakQuestions"]}/{E4["total"]} 题会搜到越权文档</td></tr>
      <tr><td>时效</td><td>排除已被取代的版本 + 出处标题带更新日</td><td>E5：不处理时旧版 3/3 排在前面</td></tr>
      <tr><td>可信度阈值与兜底</td><td>重排分数 -4，低于则改写重搜 1 次，仍低则兜底</td><td>E6：单一阈值无法同时避免误拒和误答，所以加改写回路</td></tr>
      <tr><td>是否多轮</td><td>否（每问独立）</td><td>范围控制。加多轮 = rewrite 节点做指代消解 + checkpointer</td></tr>
      <tr><td>人工介入</td><td>fallback 是接入点</td><td>生产里把 fallback 接到工单或 IM 通知，人工回答后补进评测集</td></tr>
      <tr><td>评测集</td><td>46 题 · 7 种题型 · 按原文片段标注</td><td>同一套标注能评任何切块策略</td></tr>
    </tbody>
  </table></div>

  <h3>System design 题的讲法：「给连锁餐饮做一个员工问答机器人」</h3>
  <ol>
    <li><strong>先问边界</strong>：资料有哪些、多少、多久更新一次；有没有权限差异；答错的代价有多大（规程问答和食品安全问答不一样）；用户在哪里问（IM、店铺平板）。</li>
    <li><strong>离线管线</strong>：按结构切块、带上 ACL / 版本 / 更新日元数据；增量同步；embedding 模型版本固定。</li>
    <li><strong>在线状态图</strong>：路由 → 改写 → 混合召回（权限前过滤、排除旧版）→ 重排 → 评分（低分时改写重搜）→ 带原生引用的生成 → 核验 → 兜底。</li>
    <li><strong>评测先行</strong>：先标 50 题，检索层和端到端分开评，每个组件用消融实验证明价值。</li>
    <li><strong>上线后</strong>：监控兜底率、平均重试次数、引用覆盖率、点踩；兜底和点踩的问题人工标注后补进评测集。</li>
  </ol>
  <div class="note"><span class="lbl">把实测数字变成你自己的</span>
    <p>这一页的数字都来自本机实跑（<code>results/experiments.json</code>）。面试前自己跑一遍 <code>npm run exp</code> 和 <code>npm run e2e</code>，再做一两个「故意搞坏」实验，记下前后的数字。「我在一个 46 题的日语评测集上测过，加重排后 R@1 从 76% 到 92%」比「重排很重要」有说服力得多。</p>
  </div>
</section>
</main></div></div>
''')

out = os.path.join(R, "tools/rag-design-lab.html")
open(out, "w", encoding="utf8").write("".join(P))
print("wrote", out, os.path.getsize(out))
