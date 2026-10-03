import { and, desc, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client';
import { auditEvents } from '../db/schema';

export type AuditType =
  | 'workspace.created' | 'agent_run.started' | 'agent_run.succeeded' | 'agent_run.failed'
  | 'plan.version_created' | 'dry_run.completed' | 'plan.approved' | 'plan.superseded'
  | 'execution.started' | 'execution.succeeded' | 'execution.failed' | 'execution.interrupted'
  | 'rollback.completed' | 'reconciliation.completed';

export interface AuditEventDto {
  id: number;
  type: string;
  actor: string;
  subjectType: string | null;
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function recordEvent(
  tx: DbOrTx,
  e: { workspaceId: string; type: AuditType; actor: string; subjectType?: string; subjectId?: string; payload?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(auditEvents).values({
    workspaceId: e.workspaceId, type: e.type, actor: e.actor,
    subjectType: e.subjectType ?? null, subjectId: e.subjectId ?? null, payload: e.payload ?? {},
  });
}

export async function listEvents(workspaceId: string, opts: { type?: string; limit?: number } = {}): Promise<AuditEventDto[]> {
  const where = opts.type
    ? and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.type, opts.type))
    : eq(auditEvents.workspaceId, workspaceId);
  const rows = await db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.id)).limit(opts.limit ?? 500);
  return rows.reverse().map((r) => ({
    id: r.id, type: r.type, actor: r.actor, subjectType: r.subjectType, subjectId: r.subjectId,
    payload: r.payload as Record<string, unknown>, createdAt: r.createdAt.toISOString(),
  }));
}
