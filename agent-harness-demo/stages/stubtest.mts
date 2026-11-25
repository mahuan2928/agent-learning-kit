// Stub-client self test for stage s11 (final). Run with cwd = scratch ws.
process.env.BASH_TIMEOUT_MS = "1500";
process.env.AGENT_YES = "1";
process.env.COMPACT_AT = "5000";
import { writeFileSync, readFileSync, existsSync, unlinkSync, appendFileSync } from "node:fs";

const S = new URL("./s11/src", import.meta.url).pathname;
const { ContextAssembler, buildSystem } = await import(`${S}/context.ts`);
const { buildTools } = await import(`${S}/tools.ts`);
const { SessionStore } = await import(`${S}/session.ts`);
const { HookRunner } = await import(`${S}/hooks.ts`);
const { runLoop } = await import(`${S}/loop.ts`);

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`); if (!cond) fails++; };

type Step = (req: any) => any;
let n = 0;
function msg(content: any[], stop = "end_turn", input_tokens = 100) {
  return { id: `msg_${++n}`, type: "message", role: "assistant", model: "stub", content, stop_reason: stop,
    stop_sequence: null, usage: { input_tokens, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
}
const tu = (name: string, input: any) => ({ type: "tool_use", id: `toolu_${++n}`, name, input });
const txt = (t: string) => ({ type: "text", text: t, citations: null });

function stub(steps: Step[]) {
  const reqs: any[] = [];
  let i = 0;
  return {
    reqs,
    messages: {
      stream(req: any, { signal }: { signal: AbortSignal }) {
        reqs.push(JSON.parse(JSON.stringify(req)));
        const step = steps[i++];
        if (!step) throw new Error("stub: no more steps");
        const m = step(req);
        return {
          async *[Symbol.asyncIterator]() {
            if ((m as any).__delay) await new Promise((r) => setTimeout(r, (m as any).__delay));
            if (signal.aborted) throw new Error("aborted");
            yield { type: "message_start", message: m };
          },
          finalMessage: async () => m,
        };
      },
      async create() { return msg([txt("SUMMARY")]); },
    },
  } as any;
}

async function run(client: any, prompt: string, opts: any = {}, abortAfter?: number) {
  const store = opts.store ?? new SessionStore();
  const tools = buildTools(store);
  const ctx = opts.ctx ?? new ContextAssembler(buildSystem({ cwd: process.cwd(), model: "stub" }), tools, (e: any) => store.append(e));
  if (prompt) ctx.appendUser(prompt);
  const ac = new AbortController();
  if (abortAfter) setTimeout(() => ac.abort(), abortAfter);
  const events: any[] = [];
  const t0 = Date.now();
  for await (const ev of runLoop(client, ctx, tools, new HookRunner(), ac.signal,
    { model: "stub", maxTokens: 1000, maxTurns: 10, maxBudgetUsd: 5, sessionId: store.id, ask: async () => true }))
    events.push(ev);
  return { events, ctx, store, ms: Date.now() - t0, result: events.find((e) => e.type === "result") };
}

// 1. parallel reads + write + rm blocked + rewrite
{
  const c = stub([
    () => msg([tu("read_file", { path: "a.txt" }), tu("read_file", { path: "/etc/passwd" }), tu("read_file", { path: "nope.txt" }),
               tu("write_file", { path: "b.txt", content: "X" }), tu("run_bash", { command: "rm -rf tmp" }),
               tu("run_bash", { command: "echo 'hi there'" })], "tool_use"),
    () => msg([txt("done")]),
  ]);
  const r = await run(c, "go");
  const blocks = r.events.find((e: any) => e.type === "user").content;
  check("1 success", r.result.subtype === "success");
  check("1 read ok", blocks[0].content.trim() === "hello" && !blocks[0].is_error);
  check("1 outside denied", blocks[1].is_error && blocks[1].content.startsWith("DENIED"));
  check("1 not found", blocks[2].content.startsWith("NOT_FOUND") && blocks[2].content.includes("重试不会成功"));
  check("1 write ok", readFileSync("b.txt", "utf8") === "X");
  check("1 rm blocked by hook", blocks[4].content.startsWith("DENIED") && blocks[4].content.includes("hook"), blocks[4].content.split("\n")[0]);
  check("1 bash rewritten+runs", blocks[5].content.trim() === "hi there", JSON.stringify(blocks[5].content));
  check("1 ids paired in order", blocks.length === 6);
  check("1 cache breakpoints", c.reqs[1].tools.at(-1).cache_control && c.reqs[1].system.at(-1).cache_control &&
        JSON.stringify(c.reqs[1].messages.at(-2)).includes("cache_control"));
  r.store.rollbackAll();
  check("1 rollback leaves new file (by design)", existsSync("b.txt"));
  unlinkSync("b.txt");
}

// 2. timeout kills process group (grandchild holds stdout)
{
  const c = stub([() => msg([tu("run_bash", { command: "sleep 100 & echo started; sleep 100" })], "tool_use"), () => msg([txt("ok")])]);
  const r = await run(c, "go");
  const b = r.events.find((e: any) => e.type === "user").content[0];
  check("2 timeout returns", b.content.startsWith("TIMEOUT") && r.ms < 5000, `${r.ms}ms ${b.content.split("\n")[0]}`);
}

// 3. interrupt during tool
{
  const c = stub([() => msg([tu("read_file", { path: "a.txt" }), tu("run_bash", { command: "sleep 30 & sleep 30" })], "tool_use")]);
  const r = await run(c, "go", {}, 500);
  check("3 interrupted fast", r.result.subtype === "interrupted" && r.ms < 3000, `${r.ms}ms`);
  check("3 I1 holds", r.ctx.validate().length === 0);
}

// 4. interrupt while streaming → assistant message never appended
{
  const c = stub([() => ({ ...msg([txt("half"), tu("read_file", { path: "a.txt" })], "tool_use"), __delay: 300 })]);
  const r = await run(c, "go", {}, 100);
  check("4 interrupted mid-stream, nothing appended", r.result.subtype === "interrupted" && r.ctx.length === 1 && r.ctx.validate().length === 0, `${r.result.subtype} len=${r.ctx.length}`);
}

// 5. Stop hook blocks then caps
{
  writeFileSync("FAIL", "");
  const c = stub([() => msg([txt("a")]), () => msg([txt("b")]), () => msg([txt("c")]), () => msg([txt("d")])]);
  const r = await run(c, "go");
  check("5 stop blocked 3x then end", c.reqs.length === 4 && r.result.subtype === "success", `reqs=${c.reqs.length}`);
  unlinkSync("FAIL");
  const c2 = stub([() => msg([txt("a")])]);
  const r2 = await run(c2, "go");
  check("5 green passes at once", c2.reqs.length === 1 && r2.result.subtype === "success");
}

// 6. max_tokens drops truncated message
{
  const c = stub([() => msg([tu("read_file", { path: "a.txt" })], "max_tokens"), (req) => msg([txt(`budget ${req.max_tokens}`)])]);
  const r = await run(c, "go");
  check("6 max_tokens retry doubled", r.result.result === "budget 2000" && c.reqs[1].messages.length === 1);
}

// 7. compaction + journal + resume
{
  const c = stub([
    () => msg([tu("read_file", { path: "a.txt" })], "tool_use", 9000),
    () => msg([tu("read_file", { path: "a.txt" })], "tool_use", 100),
    () => msg([txt("fin")]),
  ]);
  const r = await run(c, "go");
  check("7 compacted", r.events.some((e: any) => e.subtype === "compact_boundary") &&
        String(c.reqs[1].messages[0].content).startsWith("[已压缩]") || JSON.stringify(c.reqs[1].messages[0]).includes("[已压缩]"));
  const lines = readFileSync(r.store.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  check("7 journal has compact", lines.some((l) => l.kind === "compact"));
  const s2 = new SessionStore(r.store.id);
  const ctx2 = new ContextAssembler(buildSystem({ cwd: process.cwd(), model: "stub" }), buildTools(s2), (e: any) => s2.append(e));
  ctx2.restore(s2.load());
  check("7 restore matches", ctx2.length === r.ctx.length, `${ctx2.length} vs ${r.ctx.length}`);
}

// 8. crash: orphan tail + truncated line
{
  const s = new SessionStore();
  const ctx = new ContextAssembler(buildSystem({ cwd: process.cwd(), model: "stub" }), buildTools(s), (e: any) => s.append(e));
  ctx.appendUser("task");
  ctx.appendAssistant([tu("read_file", { path: "a.txt" })] as any);
  appendFileSync(s.path, '{"t":"x","kind":"mess');
  const s2 = new SessionStore(s.id);
  const ctx2 = new ContextAssembler(buildSystem({ cwd: process.cwd(), model: "stub" }), buildTools(s2), (e: any) => s2.append(e));
  ctx2.restore(s2.load());
  const fixed = ctx2.repairOrphans();
  check("8 repaired orphan", fixed.length === 1 && ctx2.validate().length === 0);
  let threw = false;
  try { ctx2.appendAssistant([tu("read_file", { path: "a.txt" })] as any); ctx2.appendUser("x"); ctx2.assemble("m", 10); } catch (e) { threw = String(e).includes("I1 violated"); }
  check("8 assemble catches orphan", threw);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
