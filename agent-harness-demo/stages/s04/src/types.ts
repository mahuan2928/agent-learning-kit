/** 一个工具 = 给模型看的三样 (name / description / inputSchema) + 给 harness 用的 run */
export interface ToolDef<I = any> {
  name: string;
  description: string;        // 不只是参数说明, 是随工具加载的局部 system prompt
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** 副作用分类, 决定护栏形态 (I3): none 不管 / reversible 快照兜底 / 其余执行前问人 */
  effect: "none" | "reversible" | "irreversible" | "external";
  run(input: I): Promise<string>;
}
