import { canonicalJson } from '../hash';
import { executablePlan, type MappingCore } from './hash';
import type { Plan } from './schema';

export interface PlanDiff {
  added: string[];
  removed: string[];
  changed: { targetField: string; before: MappingCore; after: MappingCore }[];
  unmappedAdded: string[];
  unmappedRemoved: string[];
  identical: boolean;
}

export function diffPlans(a: Plan, b: Plan): PlanDiff {
  const ea = executablePlan(a);
  const eb = executablePlan(b);
  const before = new Map(ea.mappings.map((m) => [m.targetField, m]));
  const after = new Map(eb.mappings.map((m) => [m.targetField, m]));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.entries()]
    .filter(([k, m]) => before.has(k) && canonicalJson(before.get(k)) !== canonicalJson(m))
    .map(([k, m]) => ({ targetField: k, before: before.get(k)!, after: m }));
  const ua = new Set(ea.unmappedSourceFields.map((u) => u.field));
  const ub = new Set(eb.unmappedSourceFields.map((u) => u.field));
  const unmappedAdded = [...ub].filter((f) => !ua.has(f));
  const unmappedRemoved = [...ua].filter((f) => !ub.has(f));
  return {
    added, removed, changed, unmappedAdded, unmappedRemoved,
    identical: !added.length && !removed.length && !changed.length && !unmappedAdded.length && !unmappedRemoved.length,
  };
}
