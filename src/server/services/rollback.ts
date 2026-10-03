import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { migrationRuns, planVersions, rollbacks } from '../db/schema';
import { AppError } from '../errors';
import { recordEvent } from './audit';
import { activeRuns } from './executions';
import { deleteMigrated } from './target-store';
import { getWorkspace } from './workspaces';

export async function rollbackMigration(workspaceId: string, actor: string) {
  await getWorkspace(workspaceId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'ws:' + workspaceId}))`);
    const active = await activeRuns(tx, workspaceId);
    if (active.some((r) => r.status === 'running')) throw new AppError('RUN_IN_PROGRESS', 'Cannot roll back while a run is in progress');
    if (!active.length) throw new AppError('NOTHING_TO_ROLLBACK', 'There is no active migration to roll back');
    const runIds = active.map((r) => r.id);
    const rowsDeleted = await deleteMigrated(tx, workspaceId, runIds);
    await tx.update(migrationRuns).set({ status: 'rolled_back' }).where(inArray(migrationRuns.id, runIds));
    const [v] = await tx.select({ version: planVersions.version }).from(planVersions).where(eq(planVersions.id, active[0].planVersionId));
    const [row] = await tx.insert(rollbacks).values({ workspaceId, planVersionId: active[0].planVersionId, runIds, rowsDeleted }).returning();
    await recordEvent(tx, { workspaceId, type: 'rollback.completed', actor, subjectType: 'rollback', subjectId: row.id,
      payload: { rowsDeleted, runIds, version: v?.version } });
    return { id: row.id, rowsDeleted, runIds, version: v?.version ?? 0 };
  });
}
