/** 一个工具 = 给模型看的三样 (name / description / inputSchema) + 给 harness 用的其余字段 */
export interface ToolDef<I = any> {
  name: string;
  description: string;        // 不只是参数说明, 是随工具加载的局部 system prompt
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** 副作用分类, 决定护栏形态 (I3): none 不管 / reversible 快照兜底 / 其余执行前问人 */
  effect: "none" | "reversible" | "irreversible" | "external";
  /** 能否和别的调用并发。默认 false: 漏写最多慢一点, 反过来漏写会写坏数据 */
  readOnly?: boolean;
  run(input: I, signal: AbortSignal): Promise<string>;
}

/** 权限门的判决。allow 时可以带回改写过的入参 (Stage 10 的 hook 会用到) */
export type GateDecision = { allow: true; input: unknown } | { allow: false; reason: string };
export type Gate = (tool: ToolDef, input: unknown) => Promise<GateDecision>;

export interface ToolCall { id: string; name: string; input: unknown }
export interface ToolOutcome { toolUseId: string; content: string; isError: boolean }
