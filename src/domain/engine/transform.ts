import { extractField } from '../schemas/source';
import type { TargetRow } from '../schemas/target';
import type { FieldError, Scalar } from '../types';
import type { CompiledMapping, CompiledStep } from './compile';

export type PipelineResult =
  | { ok: true; value: Scalar }
  | { ok: false; rule: string; code: string; message: string };

export function runPipeline(value: Scalar, steps: CompiledStep[]): PipelineResult {
  let current = value;
  for (const step of steps) {
    const result = step.rule.apply(current, step.params);
    if (!result.ok) return { ok: false, rule: step.ruleName, code: result.code, message: result.message };
    current = result.value;
  }
  return { ok: true, value: current };
}

export function transformRecord(
  raw: Record<string, unknown>,
  mappings: CompiledMapping[],
): { row: Partial<TargetRow>; errors: FieldError[] } {
  const row: Partial<TargetRow> = {};
  const errors: FieldError[] = [];
  for (const m of mappings) {
    const sourceValue = m.sourceField ? extractField(raw, m.sourceField) : null;
    const result = runPipeline(sourceValue, m.steps);
    if (result.ok) row[m.targetField] = result.value;
    else errors.push({ targetField: m.targetField, sourceField: m.sourceField, sourceValue,
      rule: result.rule, code: result.code, message: result.message });
  }
  return { row, errors };
}
