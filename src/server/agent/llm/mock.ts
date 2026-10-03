import type { LLMMessage, LLMProvider, LLMSession, LLMTurn, ToolCall, ToolDecl } from './types';

export type MockStep = { calls?: ToolCall[]; text?: string; delayMs?: number };

/** Replays a fixed script. Used by tests, CI and `LLM_PROVIDER=mock` demos. */
export class MockProvider implements LLMProvider {
  readonly sessions: { system: string; tools: ToolDecl[]; received: LLMMessage[] }[] = [];
  constructor(private readonly script: MockStep[], readonly model = 'mock-scripted') {}

  startSession(opts: { system: string; tools: ToolDecl[] }): LLMSession {
    const record = { ...opts, received: [] as LLMMessage[] };
    this.sessions.push(record);
    let i = 0;
    const script = this.script;
    return {
      async send(message: LLMMessage, signal?: AbortSignal): Promise<LLMTurn> {
        record.received.push(message);
        const step = script[i++];
        if (!step) throw new Error('MockProvider script exhausted');
        if (step.delayMs) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, step.delayMs);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
          });
        }
        return { text: step.text ?? null, calls: step.calls ?? [], usage: { inputTokens: 100, outputTokens: 20 } };
      },
    };
  }
}
