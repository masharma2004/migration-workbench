import { GoogleGenAI, type Content } from '@google/genai';
import type { LLMMessage, LLMProvider, LLMSession, LLMTurn, ToolDecl } from './types';
import { LLMUnavailableError } from './types';

export function extractText(content: Content | undefined): string | null {
  const text = (content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  return text.trim() ? text : null;
}

export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 429 || (typeof status === 'number' && status >= 500);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GeminiProvider implements LLMProvider {
  private readonly ai: GoogleGenAI;
  constructor(apiKey: string, readonly model: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  startSession({ system, tools }: { system: string; tools: ToolDecl[] }): LLMSession {
    const contents: Content[] = [];
    const { ai, model } = this;
    const functionDeclarations = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));

    return {
      async send(message: LLMMessage, signal?: AbortSignal): Promise<LLMTurn> {
        if ('text' in message) {
          contents.push({ role: 'user', parts: [{ text: message.text }] });
        } else {
          contents.push({ role: 'user', parts: message.toolResults.map(({ call, result }) => ({
            functionResponse: { id: call.id, name: call.name, response: { result } } })) });
        }
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await ai.models.generateContent({
              model, contents,
              config: { systemInstruction: system, temperature: 0, tools: [{ functionDeclarations }], abortSignal: signal },
            });
            const content = res.candidates?.[0]?.content;
            // Replay the model's own content verbatim (keeps thought signatures required by Gemini 2.5+).
            if (content) contents.push(content);
            return {
              text: extractText(content),
              calls: (res.functionCalls ?? []).map((c) => ({ id: c.id, name: c.name ?? '', args: (c.args ?? {}) as Record<string, unknown> })),
              usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 },
            };
          } catch (err) {
            lastErr = err;
            if (signal?.aborted || !isRetryable(err) || attempt === 2) break;
            await sleep(attempt === 0 ? 1000 : 3000);
          }
        }
        if (signal?.aborted) throw new LLMUnavailableError('LLM call aborted (time budget exceeded)');
        const status = (lastErr as { status?: number })?.status;
        throw new LLMUnavailableError(`Gemini request failed${status ? ` (HTTP ${status})` : ''}: ${(lastErr as Error)?.message ?? 'unknown error'}`);
      },
    };
  }
}
