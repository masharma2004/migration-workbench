export interface ToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}
export type LLMMessage = { text: string } | { toolResults: { call: ToolCall; result: unknown }[] };
export interface LLMTurn {
  text: string | null;
  calls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}
export interface LLMSession {
  send(message: LLMMessage, signal?: AbortSignal): Promise<LLMTurn>;
}
export interface LLMProvider {
  readonly model: string;
  startSession(opts: { system: string; tools: ToolDecl[] }): LLMSession;
}
export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMUnavailableError';
  }
}
