import { hashOf } from '../hash';
import { getRule } from '../rules';
import type { Plan } from './schema';

export interface MappingCore {
  targetField: string;
  sourceField: string | null;
  transforms: { rule: string; params: unknown }[];
}

function normaliseParams(rule: string, params: unknown): unknown {
  const def = getRule(rule);
  if (!def) return params;
  const parsed = def.params.safeParse(params ?? {});
  return parsed.success ? parsed.data : params;
}

/** The part of a plan that determines execution. Metadata (rationale, confidence) is excluded. */
export function executablePlan(plan: Plan) {
  return {
    sourceSchemaVersion: plan.sourceSchemaVersion,
    targetSchemaVersion: plan.targetSchemaVersion,
    mappings: [...plan.mappings]
      .sort((a, b) => a.targetField.localeCompare(b.targetField))
      .map<MappingCore>((m) => ({
        targetField: m.targetField,
        sourceField: m.sourceField,
        transforms: m.transforms.map((t) => ({ rule: t.rule, params: normaliseParams(t.rule, t.params) })),
      })),
    unmappedSourceFields: [...plan.unmappedSourceFields]
      .sort((a, b) => a.field.localeCompare(b.field))
      .map((u) => ({ field: u.field, decision: u.decision })),
  };
}

export function planHash(plan: Plan): string {
  return hashOf(executablePlan(plan));
}
