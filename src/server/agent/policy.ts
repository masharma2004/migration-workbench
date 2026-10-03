import type { Question, VersionContent } from '@/domain/plan';
import { getTargetField } from '@/domain/schemas/target';

export interface ReviewSignals {
  /** Source fields where the tools observed ambiguous day/month dates. */
  ambiguousDateFields: string[];
}

type StepLike = { toolName: string | null; args: unknown; result: unknown };

/** Derives review signals from the agent's own tool results (deterministic, not model judgement). */
export function collectSignals(steps: StepLike[]): ReviewSignals {
  const fields = new Set<string>();
  const ambiguousProfile = (p: { field?: string; patterns?: { pattern: string }[] }) => {
    if (p.field && p.patterns?.some((x) => x.pattern.includes('ambiguous'))) fields.add(p.field);
  };
  for (const s of steps) {
    const result = s.result as Record<string, unknown> | null;
    if (!result) continue;
    if (s.toolName === 'profile_field') {
      const profiles = Array.isArray(result.profiles) ? result.profiles : [result];
      for (const p of profiles) ambiguousProfile(p as { field?: string; patterns?: { pattern: string }[] });
    }
    if (s.toolName === 'test_transformation' && Array.isArray(result.warnings)
      && result.warnings.some((w: { code?: string }) => w.code === 'AMBIGUOUS_DATE')) {
      const source = (s.args as { sourceField?: string } | null)?.sourceField;
      if (source) fields.add(source);
    }
  }
  return { ambiguousDateFields: [...fields].sort() };
}

/**
 * Human-review policy enforced on every agent draft:
 * - answers come only from humans, so model-written answers are removed;
 * - decisions the data cannot make are blocking: required target fields filled with a constant
 *   (e.g. marketing consent) and source fields with ambiguous dates. Missing questions are added
 *   as labelled system questions.
 */
export function enforceReviewPolicy(content: VersionContent, signals: ReviewSignals): VersionContent {
  const questions: Question[] = content.questions.map(({ answer: _modelAnswer, ...q }) => ({ ...q }));
  const requireBlocking = (fields: string[], make: () => Question) => {
    const related = questions.filter((q) => q.relatedFields.some((f) => fields.includes(f)));
    if (related.length) related.forEach((q) => { q.blocking = true; });
    else questions.push(make());
  };

  for (const m of content.plan.mappings) {
    if (m.sourceField === null && getTargetField(m.targetField)?.required) {
      requireBlocking([m.targetField], () => ({
        id: `sys-default-${m.targetField}`, blocking: true, relatedFields: [m.targetField], suggestedOptions: [],
        text: `[System check] ${m.targetField} is required but has no source field and will be filled with a fixed default. Is that default acceptable for every migrated record?`,
        assumption: 'The default in the plan is used for every record.',
      }));
    }
  }
  for (const field of signals.ambiguousDateFields) {
    const targets = content.plan.mappings.filter((m) => m.sourceField === field).map((m) => m.targetField);
    requireBlocking([field, ...targets], () => ({
      id: `sys-ambiguous-${field}`, blocking: true, relatedFields: [field, ...targets], suggestedOptions: [],
      text: `[System check] ${field} contains dates such as 04/05/2019 where day and month are both <= 12. They will be read using the first matching format in the plan. Is that interpretation correct?`,
      assumption: 'Ambiguous dates are read using the plan\'s format order.',
    }));
  }
  return { ...content, questions };
}
