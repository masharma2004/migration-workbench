import { z } from 'zod';
import { AppError } from '../errors';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const versionParam = z.coerce.number().int().min(1);
export const createPlanBody = z.object({
  baseVersion: z.number().int().min(1).optional(),
  content: z.unknown(),
  changeNote: z.string().max(500).optional(),
});
export const approveBody = z.object({
  approvedBy: z.string().max(100),
  note: z.string().max(1000).optional(),
  acknowledgeDryRun: z.boolean(),
});
export const agentRunBody = z.object({
  mode: z.enum(['propose', 'revise']),
  baseVersion: z.number().int().min(1).optional(),
  answers: z.record(z.string(), z.string().max(2000)).optional(),
  instructions: z.string().max(2000).optional(),
  demo: z.boolean().optional(),
});
export const executeBody = z.object({ failAfterBatches: z.number().int().min(0).max(20).nullable().optional() });
export const quarantineQuery = z.object({ stage: z.string().optional(), code: z.string().optional(), field: z.string().optional() });
export const diffQuery = z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) });
export const historyQuery = z.object({ type: z.string().optional() });

export function parseVersion(raw: string): number {
  const v = versionParam.safeParse(raw);
  if (!v.success) throw new AppError('VALIDATION_ERROR', `Invalid plan version "${raw}"`);
  return v.data;
}
