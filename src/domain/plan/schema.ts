import { z } from 'zod';

export const transformStepSchema = z.object({
  rule: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const mappingSchema = z.object({
  targetField: z.string().min(1),
  sourceField: z.string().min(1).nullable(),
  transforms: z.array(transformStepSchema).default([]),
  rationale: z.string().max(1000).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export const planSchema = z.object({
  sourceSchemaVersion: z.string(),
  targetSchemaVersion: z.string(),
  mappings: z.array(mappingSchema),
  unmappedSourceFields: z
    .array(z.object({ field: z.string(), decision: z.literal('drop'), reason: z.string().min(1).max(500) }))
    .default([]),
});

export const riskSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['high', 'medium', 'low']),
  fields: z.array(z.string()).default([]),
  description: z.string().min(1).max(1000),
  evidenceStepIds: z.array(z.number().int()).default([]),
});

export const incompatibilitySchema = z.object({
  field: z.string(),
  side: z.enum(['source', 'target']),
  kind: z.enum(['missing', 'type_mismatch', 'no_target', 'no_source']),
  description: z.string().max(1000),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(1000),
  blocking: z.boolean(),
  relatedFields: z.array(z.string()).default([]),
  suggestedOptions: z.array(z.string()).default([]),
  assumption: z.string().max(1000).default(''),
  answer: z.string().max(2000).optional(),
});

export const versionContentSchema = z.object({
  plan: planSchema,
  risks: z.array(riskSchema).default([]),
  incompatibilities: z.array(incompatibilitySchema).default([]),
  questions: z.array(questionSchema).default([]),
  summary: z.string().max(4000).default(''),
});

export type TransformStep = z.infer<typeof transformStepSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type Incompatibility = z.infer<typeof incompatibilitySchema>;
export type Question = z.infer<typeof questionSchema>;
export type VersionContent = z.infer<typeof versionContentSchema>;
