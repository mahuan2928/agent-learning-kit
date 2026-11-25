# Agent Learning Kit

[English](README.md) · **简体中文**

用 TypeScript 和 Claude API 从零学习 agent 开发的一套材料。每份都有能跑的代码和配套的讲解页面。

## 内容

| 材料 | 讲解页面 | 代码 | 说明 |
|---|---|---|---|
| 设计模式入门 | [中文](pages/patterns-intro.html) · [EN](pages/patterns-intro.en.html) | `agent-patterns/intro` | 白话版，厨房比喻 + 选模式小测验 |
| RAG 入门 | [中文](pages/rag-intro.html) · [EN](pages/rag-intro.en.html) | `rag-lab/tools` | 白话版，开卷考试比喻 + 检索演示 |
| Agent Harness 实战 | [中文](pages/agent-harness.html) · [EN](pages/agent-harness.en.html) | `agent-harness-demo/stages/s01`～`s11` | 11 个阶段，从最小循环到中断安全、缓存、压缩、持久化、Hooks、Eval |
| Agent 设计模式实战 | [中文](pages/agent-patterns.html) · [EN](pages/agent-patterns.en.html) | `agent-patterns/src` | Chaining / Routing / Parallel / Orchestrator / Evaluator / Agentic RAG，含踩坑复盘 |
| RAG 设计实战 | [中文](pages/rag-design-lab.html) · [EN](pages/rag-design-lab.en.html) | `rag-lab` | 本地 embedding + reranker 的检索实验 E1–E6，46 题评测集 |

建议顺序：两份入门 → Harness → 设计模式 → RAG 实战。

讲解页面是单个 HTML 文件，下载后用浏览器直接打开即可。

## 运行

每个目录是独立的 Node 项目：

```bash
cd agent-patterns
npm install
npm test          # 离线测试，不调用 API
npm run smoke     # 用假 API 跑通全部脚本
export ANTHROPIC_API_KEY=...
npm run p1        # 真实调用，p1 … p6
```

`rag-lab` 首次运行会下载 embedding 和 reranker 模型（约 700MB）到 `.models/`。

## 注意

- 调用真实 API 的部分没有在作者本机用真实 key 跑过，页面里关于模型输出的描述是预期行为，请以实跑结果为准。离线测试和 RAG 检索实验（E1–E6）是实测的。
- 源码里的注释是中文；英文讲解页面里展示的是同一份代码，注释已译成英文。
- 示例数据（店铺、问い合わせ、规程文档等）都是虚构的。案例设定在日本企业，所以示例输入和 prompt 是日语，这是有意为之。
