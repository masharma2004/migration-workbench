import { and, desc, eq, sql } from 'drizzle-orm';
import { diffPlans, planHash, validatePlan, versionContentSchema, type PlanIssue, type VersionContent } from '@/domain/plan';
import { db, type DbOrTx } from '../db/client';
import { planVersions } from '../db/schema';
import { AppError, notFound } from '../errors';
import { recordEvent } from './audit';
import { getWorkspace } from './workspaces';

type Row = typeof planVersions.$inferSelect;

export interface PlanVersionDto {
  id: string;
  version: number;
  parentVersionId: string | null;
  author: 'agent' | 'user';
  status: 'draft' | 'approved' | 'superseded';
  content: VersionContent;
  planHash: string;
  agentRunId: string | null;
  changeNote: string | null;
  createdAt: string;
  issues: PlanIssue[];
}

export function toDto(r: Row): PlanVersionDto {
  const content = r.content as VersionContent;
  return {
    id: r.id, version: r.version, parentVersionId: r.parentVersionId, author: r.author, status: r.status, content,
    planHash: r.planHash, agentRunId: r.agentRunId, changeNote: r.changeNote, createdAt: r.createdAt.toISOString(),
    issues: validatePlan(content.plan),
  };
}

export async function createVersion(tx: DbOrTx, input: {
  workspaceId: string; content: unknown; author: 'agent' | 'user'; parentVersionId?: string | null;
  agentRunId?: string | null; changeNote?: string | null; actor: string;
}): Promise<PlanVersionDto> {
  const parsed = versionContentSchema.safeParse(input.content);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Plan content is malformed', parsed.error.issues);
  }
  const content = parsed.data;
  const run = async (t: DbOrTx) => {
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${'plan:' + input.workspaceId}))`);
    const [last] = await t.select({ version: planVersions.version }).from(planVersions)
      .where(eq(planVersions.workspaceId, input.workspaceId)).orderBy(desc(planVersions.version)).limit(1);
    const [row] = await t.insert(planVersions).values({
      workspaceId: input.workspaceId, version: (last?.version ?? 0) + 1, parentVersionId: input.parentVersionId ?? null,
      author: input.author, content, planHash: planHash(content.plan), agentRunId: input.agentRunId ?? null,
      changeNote: input.changeNote ?? null,
    }).returning();
    await recordEvent(t, { workspaceId: input.workspaceId, type: 'plan.version_created', actor: input.actor,
      subjectType: 'plan_version', subjectId: row.id,
      payload: { version: row.version, author: row.author, planHash: row.planHash, parentVersionId: row.parentVersionId,
        changeNote: row.changeNote } });
    return toDto(row);
  };
  // Advisory xact locks need a transaction; open one if we were handed the root db.
  return tx === db ? db.transaction(run) : run(tx);
}

export async function listVersions(workspaceId: string): Promise<PlanVersionDto[]> {
  await getWorkspace(workspaceId);
  const rows = await db.select().from(planVersions).where(eq(planVersions.workspaceId, workspaceId)).orderBy(desc(planVersions.version));
  return rows.map(toDto);
}

export async function getVersion(workspaceId: string, version: number, tx: DbOrTx = db): Promise<PlanVersionDto> {
  const [row] = await tx.select().from(planVersions)
    .where(and(eq(planVersions.workspaceId, workspaceId), eq(planVersions.version, version)));
  if (!row) throw notFound(`Plan version ${version}`);
  return toDto(row);
}

export async function getVersionById(tx: DbOrTx, id: string): Promise<PlanVersionDto> {
  const [row] = await tx.select().from(planVersions).where(eq(planVersions.id, id));
  if (!row) throw notFound('Plan version');
  return toDto(row);
}

export async function diffVersions(workspaceId: string, from: number, to: number) {
  const [a, b] = await Promise.all([getVersion(workspaceId, from), getVersion(workspaceId, to)]);
  return diffPlans(a.content.plan, b.content.plan);
}
