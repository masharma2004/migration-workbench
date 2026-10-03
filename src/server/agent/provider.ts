import { GeminiProvider } from './llm/gemini';
import { MockProvider } from './llm/mock';
import type { LLMProvider } from './llm/types';
import { referenceScript } from './reference-script';

export function getProvider(): LLMProvider | null {
  if ((process.env.LLM_PROVIDER ?? 'gemini') === 'mock') return new MockProvider(referenceScript());
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GeminiProvider(key, process.env.GEMINI_MODEL || 'gemini-2.5-flash');
}
