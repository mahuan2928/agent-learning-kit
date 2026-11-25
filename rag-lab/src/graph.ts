/**
 * 迷你 StateGraph: 接口照着 LangGraph 起名, 方便你把这里的代码一对一搬过去。
 *
 *   LangGraph (Python)                  这里 (TypeScript)
 *   g.add_node("x", fn)                 g.addNode("x", fn)
 *   g.add_edge("a", "b")                g.addEdge("a", "b")
 *   g.add_conditional_edges("a", f, m)  g.addConditionalEdges("a", f)
 *   g.set_entry_point("a")              g.setEntryPoint("a")
 *   app.invoke(state)                   g.invoke(state)
 *
 * 节点返回「要更新的字段」, 由图负责合并进 state —— 和 LangGraph 一样, 节点之间只通过 state 通信。
 * maxSteps 是整张图的硬上限: 条件边里的重试计数写错了, 也不会死循环。
 */
export const END = "__end__";

type Node<S> = (s: S) => Promise<Partial<S>>;
type Router<S> = (s: S) => string;

export class StateGraph<S extends object> {
  private nodes = new Map<string, Node<S>>();
  private edges = new Map<string, string | Router<S>>();
  private entry = "";

  addNode(name: string, fn: Node<S>): this { this.nodes.set(name, fn); return this; }
  addEdge(from: string, to: string): this { this.edges.set(from, to); return this; }
  addConditionalEdges(from: string, router: Router<S>): this { this.edges.set(from, router); return this; }
  setEntryPoint(name: string): this { this.entry = name; return this; }

  async invoke(initial: S, o: { maxSteps?: number; onStep?: (node: string, update: Partial<S>, ms: number) => void } = {})
    : Promise<S & { path: string[] }> {
    let state = { ...initial };
    const path: string[] = [];
    let cur = this.entry;
    for (let step = 0; cur !== END; step++) {
      if (step >= (o.maxSteps ?? 20)) throw new Error(`图执行超过 ${o.maxSteps ?? 20} 步: ${path.join(" → ")}`);
      const fn = this.nodes.get(cur);
      if (!fn) throw new Error(`没有节点 ${cur}`);
      const t0 = Date.now();
      const update = await fn(state);
      state = { ...state, ...update };
      path.push(cur);
      o.onStep?.(cur, update, Date.now() - t0);
      const e = this.edges.get(cur);
      if (e === undefined) throw new Error(`节点 ${cur} 没有出边`);
      cur = typeof e === "string" ? e : e(state);
    }
    return { ...state, path };
  }
}
