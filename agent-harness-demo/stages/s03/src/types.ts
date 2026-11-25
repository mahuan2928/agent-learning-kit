/** 一个工具 = 给模型看的三样 (name / description / inputSchema) + 给 harness 用的 run */
export interface ToolDef<I = any> {
  name: string;
  description: string;        // 不只是参数说明, 是随工具加载的局部 system prompt
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(input: I): Promise<string>;
}
