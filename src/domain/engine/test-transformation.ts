import type { PlanIssue, TransformStep } from '../plan';
import { getRule } from '../rules';
import { extractField, isSourceField } from '../schemas/source';
import { getTargetField } from '../schemas/target';
import type { Scalar, SourceRecordInput } from '../types';
import type { CompiledStep } from './compile';
import { runPipeline } from './transform';
import { validateTargetValue } from './validate-target';

export interface TransformationTestResult {
  total: number;
  passed: number;
  failed: number;
  failureCodes: Record<string, number>;
  failures: { seq: number; sourceValue: string | null; code: string; message: string }[];
  samples: { seq: number; sourceValue: string | null; output: Scalar }[];
}

export function testTransformation(
  records: SourceRecordInput[],
  input: { sourceField: string | null; targetField: string; transforms: TransformStep[] },
): TransformationTestResult | { issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const target = getTargetField(input.targetField);
  if (!target) issues.push({ path: 'targetField', code: 'UNKNOWN_TARGET_FIELD', message: `Unknown target field "${input.targetField}"` });
  if (input.sourceField !== null && !isSourceField(input.sourceField)) {
    issues.push({ path: 'sourceField', code: 'UNKNOWN_SOURCE_FIELD', message: `Unknown source field "${input.sourceField}"` });
  }
  const steps: CompiledStep[] = [];
  input.transforms.forEach((t, i) => {
    const rule = getRule(t.rule);
    if (!rule) { issues.push({ path: `transforms[${i}]`, code: 'UNKNOWN_RULE', message: `Unknown rule "${t.rule}"` }); return; }
    const parsed = rule.params.safeParse(t.params ?? {});
    if (!parsed.success) { issues.push({ path: `transforms[${i}].params`, code: 'INVALID_PARAMS', message: parsed.error.issues.map((x) => x.message).join('; ') }); return; }
    steps.push({ ruleName: t.rule, rule, params: parsed.data });
  });
  if (issues.length || !target) return { issues };

  const result: TransformationTestResult = { total: 0, passed: 0, failed: 0, failureCodes: {}, failures: [], samples: [] };
  for (const rec of [...records].sort((a, b) => a.seq - b.seq)) {
    result.total += 1;
    const sourceValue = input.sourceField ? extractField(rec.raw, input.sourceField) : null;
    const out = runPipeline(sourceValue, steps);
    const problem = out.ok ? validateTargetValue(target, out.value) : { code: out.code, message: out.message };
    if (problem) {
      result.failed += 1;
      result.failureCodes[problem.code] = (result.failureCodes[problem.code] ?? 0) + 1;
      if (result.failures.length < 5) result.failures.push({ seq: rec.seq, sourceValue, ...problem });
    } else {
      result.passed += 1;
      if (result.samples.length < 5 && out.ok) result.samples.push({ seq: rec.seq, sourceValue, output: out.value });
    }
  }
  return result;
}
