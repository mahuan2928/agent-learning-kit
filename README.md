# Agent Learning Kit

**English** · [简体中文](README.zh-CN.md)

A hands-on curriculum for building LLM agents from first principles with TypeScript and the Claude API. Each module pairs runnable code with a self-contained walkthrough page.

## Modules

| Module | Walkthrough | Code | What it covers |
|---|---|---|---|
| Agent Design Patterns: A Gentle Introduction | [EN](pages/patterns-intro.en.html) · [中文](pages/patterns-intro.html) | `agent-patterns/intro` | Plain-language tour of the core patterns through a kitchen metaphor, with a pattern-selection quiz |
| RAG: A Gentle Introduction | [EN](pages/rag-intro.en.html) · [中文](pages/rag-intro.html) | `rag-lab/tools` | Retrieval-augmented generation explained as an open-book exam, with an interactive retrieval demo |
| Building an Agent Harness | [EN](pages/agent-harness.en.html) · [中文](pages/agent-harness.html) | `agent-harness-demo/stages/s01`–`s11` | Eleven incremental stages, from a minimal tool loop to interrupt safety, prompt caching, compaction, persistence, hooks, and evals |
| Agent Design Patterns in Practice | [EN](pages/agent-patterns.en.html) · [中文](pages/agent-patterns.html) | `agent-patterns/src` | Prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, and agentic RAG on realistic business cases, plus a latency post-mortem |
| RAG Design Lab | [EN](pages/rag-design-lab.en.html) · [中文](pages/rag-design-lab.html) | `rag-lab` | Retrieval experiments E1–E6 with local embeddings and a cross-encoder reranker, evaluated on a 46-question set |

Suggested order: the two introductions, then the harness, then design patterns, then the RAG lab.

Each walkthrough is a single self-contained HTML file. Download it and open it in a browser.

## Running the code

Each directory is an independent Node.js project:

```bash
cd agent-patterns
npm install
npm test          # offline tests, no API calls
npm run smoke     # runs every script end to end against a stubbed API
export ANTHROPIC_API_KEY=...
npm run p1        # live run: p1 … p6
```

On first run, `rag-lab` downloads the embedding and reranker models (about 700 MB) into `.models/`.

## Notes

- The offline tests and the RAG retrieval experiments (E1–E6) were run and their results are real. Code paths that call the live API have not been run with a real key; where a walkthrough describes model output, treat it as expected behavior and verify by running it yourself.
- Comments in the source files are in Chinese. The English walkthroughs show the same code with comments translated.
- All sample data (stores, customer inquiries, policy documents) is fictional. The business cases are set in Japanese companies, so sample inputs and prompts are in Japanese by design.
