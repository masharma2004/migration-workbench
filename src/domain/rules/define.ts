import type { z } from 'zod';
import type { RuleResult, Scalar } from '../types';

export interface RuleDef<P = unknown> {
  name: string;
  description: string;
  params: z.ZodType<P>;
  apply(value: Scalar, params: P): RuleResult;
}

export function defineRule<P>(def: RuleDef<P>): RuleDef<P> {
  return def;
}

export const ok = (value: Scalar): RuleResult => ({ ok: true, value });
export const fail = (code: string, message: string): RuleResult => ({ ok: false, code, message });
export const asText = (value: Scalar): string => (typeof value === 'string' ? value : String(value));
