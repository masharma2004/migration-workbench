import { desc, eq } from 'drizzle-orm';
import { reconcile, type ReconcileResult } from '@/domain/reconcile';
import { SEED_PREEXISTING_TARGET } from '@/seed';
import { db } from '../db/client';
import { planVersions, reconciliations } from '../db/schema';
import { recordEvent } from './audit';
import { computeReport } from './dry-runs';
import { activeRuns } from './executions';
import { getVersionById } from './plans';
import { allMigratedRows, preexistingRows } from './target-store';
import { getWorkspace } from './workspaces';

export interface ReconciliationDto { id: string; version: number | null; result: 'pass' | 'fail'; details: ReconcileResult; createdAt: string }

export async function runReconciliation(workspaceId: string, actor: string): Promise<ReconciliationDto> {
  const ws = await getWorkspace(workspaceId);
  return db.transaction(async (tx) => {
    const active = await activeRuns(tx, workspaceId);
    const version = active.length ? await getVersionById(tx, active[0].planVersionId) : null;
    const report = version ? (await computeReport(tx, workspaceId, version)).report : null;
    // All migrated rows count: rows from rolled-back runs should not exist, so any are "unexpected".
    const migrated = (await allMigratedRows(tx, workspaceId)).map(({ legacyId, row }) => ({ legacyId, row }));
    const details = reconcile({
      sourceCount: ws.sourceCount, report, migrated,
      preexistingExpected: SEED_PREEXISTING_TARGET, preexistingActual: await preexistingRows(tx, workspaceId),
    });
    const [row] = await tx.insert(reconciliations).values({
      workspaceId, planVersionId: version?.id ?? null, result: details.result, details }).returning();
    await recordEvent(tx, { workspaceId, type: 'reconciliation.completed', actor, subjectType: 'reconciliation', subjectId: row.id,
      payload: { result: details.result, version: version?.version ?? null,
        failedChecks: details.checks.filter((c) => !c.passed).map((c) => c.id) } });
    return { id: row.id, version: version?.version ?? null, result: details.result, details, createdAt: row.createdAt.toISOString() };
  });
}

export async function listReconciliations(workspaceId: string): Promise<ReconciliationDto[]> {
  await getWorkspace(workspaceId);
  const rows = await db.select({ r: reconciliations, version: planVersions.version }).from(reconciliations)
    .leftJoin(planVersions, eq(planVersions.id, reconciliations.planVersionId))
    .where(eq(reconciliations.workspaceId, workspaceId)).orderBy(desc(reconciliations.createdAt));
  return rows.map(({ r, version }) => ({ id: r.id, version: version ?? null, result: r.result,
    details: r.details as ReconcileResult, createdAt: r.createdAt.toISOString() }));
}
