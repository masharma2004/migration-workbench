import { describe, expect, it } from 'vitest';
import { extractText, isRetryable } from '@/server/agent/llm/gemini';
import { MockProvider } from '@/server/agent/llm/mock';

describe('gemini helpers', () => {
  it('extracts visible text and skips thought parts', () => {
    expect(extractText({ role: 'model', parts: [{ text: 'thinking', thought: true }, { text: 'Hello' }, { functionCall: { name: 'x' } }] }))
      .toBe('Hello');
    expect(extractText(undefined)).toBeNull();
  });
  it('treats 429 and 5xx as retryable', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable(new Error('x'))).toBe(false);
  });
});

describe('MockProvider', () => {
  it('replays its script per session and records what it received', async () => {
    const mock = new MockProvider([{ calls: [{ name: 'a', args: {} }] }, { text: 'done' }]);
    const s = mock.startSession({ system: 'sys', tools: [] });
    expect((await s.send({ text: 'hi' })).calls[0].name).toBe('a');
    expect((await s.send({ toolResults: [] })).text).toBe('done');
    await expect(s.send({ text: 'again' })).rejects.toThrow(/exhausted/);
    expect(mock.sessions[0].received).toHaveLength(3);
  });
});
