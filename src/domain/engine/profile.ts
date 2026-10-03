import { extractField } from '../schemas/source';
import type { SourceRecordInput } from '../types';

export interface FieldProfile {
  field: string;
  total: number;
  nullCount: number;
  nullRate: number;
  distinctCount: number;
  topValues: { value: string; count: number }[];
  patterns: { pattern: string; count: number; example: string }[];
}

function shape(value: string): string {
  return value.replace(/[A-Za-zÀ-ɏ]+/g, 'A').replace(/\d/g, '9');
}

function slashDateHint(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 12 && b <= 12) return 'day-first: first part > 12';
  if (b > 12 && a <= 12) return 'month-first: second part > 12';
  if (a <= 12 && b <= 12) return 'ambiguous: both parts <= 12';
  return 'invalid: both parts > 12';
}

function tally(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
}

export function profileField(records: SourceRecordInput[], field: string): FieldProfile {
  const values = records.map((r) => extractField(r.raw, field));
  const present = values.filter((v): v is string => v !== null);
  const examples = new Map<string, string>();
  const patternOf = (v: string) => {
    const hint = slashDateHint(v);
    const p = hint ? `${shape(v.trim())} [${hint}]` : shape(v.trim());
    if (!examples.has(p)) examples.set(p, v);
    return p;
  };
  const patterns = tally(present.map(patternOf));
  return {
    field,
    total: values.length,
    nullCount: values.length - present.length,
    nullRate: values.length ? Math.round(((values.length - present.length) / values.length) * 100) / 100 : 0,
    distinctCount: new Set(present).size,
    topValues: tally(present).slice(0, 15).map(([value, count]) => ({ value, count })),
    patterns: patterns.slice(0, 15).map(([pattern, count]) => ({ pattern, count, example: examples.get(pattern)! })),
  };
}
