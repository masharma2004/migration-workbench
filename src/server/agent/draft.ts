import { z } from 'zod';
import { validatePlan, versionContentSchema, type PlanIssue, type VersionContent } from '@/domain/plan';
import { SOURCE_SCHEMA_VERSION } from '@/domain/schemas/source';
import { TARGET_SCHEMA_VERSION } from '@/domain/schemas/target';

/** Flattened shape the model submits; the server fills schema versions. sourceField "" means "no source". */
const draftArgsSchema = z.object({
  summary: z.string().default(''),
  mappings: z.array(z.object({
    targetField: z.string(),
    sourceField: z.string().nullable().optional(),
    transforms: z.array(z.object({ rule: z.string(), params: z.unknown().optional() })).default([]),
    rationale: z.string().optional(),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
  })),
  unmappedSourceFields: z.array(z.object({ field: z.string(), decision: z.literal('drop').default('drop'), reason: z.string() })).default([]),
  risks: z.array(z.unknown()).default([]),
  incompatibilities: z.array(z.unknown()).default([]),
  questions: z.array(z.unknown()).default([]),
});
export type DraftArgs = z.input<typeof draftArgsSchema>;

export function coerceParams(params: unknown): unknown {
  if (typeof params !== 'string') return params ?? {};
  try { return JSON.parse(params); } catch { return params; }
}

export function draftToContent(args: unknown): { content?: VersionContent; issues: PlanIssue[] } {
  const parsed = draftArgsSchema.safeParse(args);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: 'MALFORMED_DRAFT', message: i.message })) };
  }
  const d = parsed.data;
  const candidate = {
    plan: {
      sourceSchemaVersion: SOURCE_SCHEMA_VERSION, targetSchemaVersion: TARGET_SCHEMA_VERSION,
      mappings: d.mappings.map((m) => ({ ...m, sourceField: m.sourceField ? m.sourceField : null,
        transforms: m.transforms.map((t) => ({ rule: t.rule, params: coerceParams(t.params) })) })),
      unmappedSourceFields: d.unmappedSourceFields,
    },
    risks: d.risks, incompatibilities: d.incompatibilities, questions: d.questions, summary: d.summary,
  };
  const content = versionContentSchema.safeParse(candidate);
  if (!content.success) {
    return { issues: content.error.issues.map((i) => ({ path: i.path.join('.'), code: 'MALFORMED_DRAFT', message: i.message })) };
  }
  return { content: content.data, issues: validatePlan(content.data.plan) };
}

export function checkEvidence(content: VersionContent, validStepIds: Set<number>): PlanIssue[] {
  const issues: PlanIssue[] = [];
  content.risks.forEach((r, i) => {
    if (!r.evidenceStepIds.length) {
      issues.push({ path: `risks[${i}]`, code: 'EVIDENCE_MISSING', message: `Risk "${r.id}" must cite at least one tool step id` });
    }
    for (const id of r.evidenceStepIds) {
      if (!validStepIds.has(id)) issues.push({ path: `risks[${i}]`, code: 'EVIDENCE_NOT_FOUND', message: `Risk "${r.id}" cites step ${id}, which is not a successful tool call` });
    }
  });
  return issues;
}
