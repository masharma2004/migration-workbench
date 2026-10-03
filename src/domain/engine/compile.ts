import { validatePlan, type Plan, type PlanIssue } from '../plan';
import { getRule, type RuleDef } from '../rules';
import { TARGET_FIELD_NAMES, type TargetField } from '../schemas/target';

export class InvalidPlanError extends Error {
  constructor(public readonly issues: PlanIssue[]) {
    super(`Plan is invalid: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'InvalidPlanError';
  }
}

export interface CompiledStep {
  ruleName: string;
  rule: RuleDef<unknown>;
  params: unknown;
}

export interface CompiledMapping {
  targetField: TargetField;
  sourceField: string | null;
  steps: CompiledStep[];
}

/** Validates the plan and pre-parses rule params. Output is ordered by target schema order. */
export function compilePlan(plan: Plan): CompiledMapping[] {
  const issues = validatePlan(plan);
  if (issues.length) throw new InvalidPlanError(issues);
  return [...plan.mappings]
    .sort((a, b) => TARGET_FIELD_NAMES.indexOf(a.targetField as TargetField) - TARGET_FIELD_NAMES.indexOf(b.targetField as TargetField))
    .map((m) => ({
      targetField: m.targetField as TargetField,
      sourceField: m.sourceField,
      steps: m.transforms.map((t) => {
        const rule = getRule(t.rule)!;
        return { ruleName: t.rule, rule, params: rule.params.parse(t.params ?? {}) };
      }),
    }));
}
