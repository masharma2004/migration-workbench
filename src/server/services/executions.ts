import { and, desc, eq, lt, ne, sql } from 'drizzle-orm';
import { EXECUTION_BATCH_SIZE } from '@/domain/limits';
import { TARGET_SCHEMA_VERSION } from '@/domain/schemas/target';
import { logger } from '../log';
import { db, type DbOrTx } from '../db/client';
import { migrationRuns, planVersions } from '../db/schema';
import { AppError } from '../errors';
import { getCurrentApproval } from './approvals';
import { recordEvent } from './audit';
import { computeReport } from './dry-runs';
import { insertMigratedBatch, storedHashes } from './target-store';
import { getWorkspace } from './workspaces';

export interface RunCounts { planned: number; inserted: number; alreadyPresent: number; conflict: number; batchesCommitted: number }
type RunRow = typeof migrationRuns.$inferSelect;
export interface MigrationRunDto {
  id: string; planVersionId: string; version: number; kind: 'execute' | 'retry'; parentRunId: string | null; attempt: number;
  status: RunRow['status']; failAfterBatches: number | null; counts: RunCounts; error: string | null;
  startedAt: string; finishedAt: string | null;
}

const emptyCounts = (): RunCounts => ({ planned: 0, inserted: 0, alreadyPresent: 0, conflict: 0, batchesCommitted: 0 });
const lockWorkspace = (tx: DbOrTx, ws: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'ws:' + ws}))`);

async function toDto(r: RunRow): Promise<MigrationRunDto> {
  const [v] = await db.select({ version: planVersions.version }).from(planVersions).where(eq(planVersions.id, r.planVersionId));
  return { id: r.id, planVersionId: r.planVersionId, version: v?.version ?? 0, kind: r.kind, parentRunId: r.parentRunId,
    attempt: r.attempt, status: r.status, failAfterBatches: r.failAfterBatches, counts: { ...emptyCounts(), ...(r.counts as RunCounts) },
    error: r.error, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null };
}

export async function activeRuns(tx: DbOrTx, workspaceId: string): Promise<RunRow[]> {
  return tx.select().from(migrationRuns)
    .where(and(eq(migrationRuns.workspaceId, workspaceId), ne(migrationRuns.status, 'rolled_back')))
    .orderBy(desc(migrationRuns.attempt));
}

/** Marks runs left in `running` (e.g. after a crash) as interrupted. Optional workspace scope; optional age threshold. */
export async function markInterruptedRuns(tx: DbOrTx, workspaceId?: string, olderThanMs = 0): Promise<number> {
  const conditions = [eq(migrationRuns.status, 'running')];
  if (workspaceId) conditions.push(eq(migrationRuns.workspaceId, workspaceId));
  if (olderThanMs > 0) conditions.push(lt(migrationRuns.startedAt, new Date(Date.now() - olderThanMs)));
  const rows = await tx.update(migrationRuns)
    .set({ status: 'interrupted', error: 'Interrupted (process stopped before the run finished)', finishedAt: new Date() })
    .where(and(...conditions)).returning();
  for (const r of rows) {
    await recordEvent(tx, { workspaceId: r.workspaceId, type: 'execution.interrupted', actor: 'system',
      subjectType: 'migration_run', subjectId: r.id, payload: { attempt: r.attempt } });
  }
  return rows.length;
}

class SimulatedFailure extends Error {}

export async function executeMigration(workspaceId: string, input: { failAfterBatches?: number | null; actor: string }): Promise<MigrationRunDto> {
  const ws = await getWorkspace(workspaceId);
  const failAfter = input.failAfterBatches ?? null;
  if (failAfter !== null && (!Number.isInteger(failAfter) || failAfter < 0)) {
    throw new AppError('VALIDATION_ERROR', 'failAfterBatches must be a non-negative integer');
  }

  // Phase 1: gate checks + claim the run, under the workspace lock.
  const { run, report } = await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await markInterruptedRuns(tx, workspaceId, 10 * 60_000);
    const [running] = await tx.select().from(migrationRuns)
      .where(and(eq(migrationRuns.workspaceId, workspaceId), eq(migrationRuns.status, 'running')));
    if (running) throw new AppError('RUN_IN_PROGRESS', 'A migration run is already in progress for this workspace');

    const current = await getCurrentApproval(tx, workspaceId);
    if (!current) throw new AppError('NOT_APPROVED', 'No approved plan version; approve a version before executing');
    const { approval, version } = current;

    const stale: string[] = [];
    if (approval.planHash !== version.planHash) stale.push('plan changed');
    if (approval.datasetHash !== ws.datasetHash) stale.push('dataset changed');
    if (approval.targetSchemaVersion !== TARGET_SCHEMA_VERSION) stale.push('target schema changed');
    const { report: rep, datasetHash } = await computeReport(tx, workspaceId, version);
    if (datasetHash !== approval.datasetHash) stale.push('dataset hash mismatch');
    if (rep.reportHash !== approval.dryRunReportHash) stale.push('dry-run result differs from the approved one');
    if (stale.length) {
      throw new AppError('APPROVAL_STALE', `Approval of version ${version.version} is stale: ${stale.join('; ')}. Re-run the dry run and approve again.`, stale);
    }

    const active = await activeRuns(tx, workspaceId);
    if (active.some((r) => r.planVersionId !== version.id)) {
      throw new AppError('ROLLBACK_REQUIRED', 'Target contains rows from a different plan version; roll back before executing this version');
    }
    const parent = active[0] ?? null;
    const [created] = await tx.insert(migrationRuns).values({
      workspaceId, planVersionId: version.id, approvalId: approval.id, kind: parent ? 'retry' : 'execute',
      parentRunId: parent?.id ?? null, attempt: (parent?.attempt ?? 0) + 1, status: 'running', failAfterBatches: failAfter,
      counts: { ...emptyCounts(), planned: rep.accepted.length },
    }).returning();
    await recordEvent(tx, { workspaceId, type: 'execution.started', actor: input.actor, subjectType: 'migration_run',
      subjectId: created.id, payload: { kind: created.kind, attempt: created.attempt, version: version.version,
        planned: rep.accepted.length, failAfterBatches: failAfter } });
    return { run: created, report: rep };
  });

  // Phase 2: insert in batches, each batch its own transaction.
  const counts: RunCounts = { ...emptyCounts(), planned: report.accepted.length };
  const log = logger.child({ component: 'execution', workspaceId, runId: run.id });
  let error: string | null = null;
  try {
    for (let i = 0; i < report.accepted.length; i += EXECUTION_BATCH_SIZE) {
      if (failAfter !== null && counts.batchesCommitted >= failAfter) {
        throw new SimulatedFailure(`Simulated failure after ${failAfter} batches`);
      }
      const batch = report.accepted.slice(i, i + EXECUTION_BATCH_SIZE);
      await db.transaction(async (tx) => {
        const inserted = new Set(await insertMigratedBatch(tx, workspaceId, run.id, batch));
        const skipped = batch.filter((a) => !inserted.has(a.legacyId));
        const hashes = await storedHashes(tx, workspaceId, skipped.map((a) => a.legacyId));
        counts.inserted += inserted.size;
        for (const a of skipped) {
          if (hashes.get(a.legacyId) === a.rowHash) counts.alreadyPresent += 1;
          else counts.conflict += 1;
        }
        counts.batchesCommitted += 1;
        await tx.update(migrationRuns).set({ counts }).where(eq(migrationRuns.id, run.id));
      });
      log.info({ batch: counts.batchesCommitted, inserted: counts.inserted, alreadyPresent: counts.alreadyPresent }, 'batch committed');
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    log.warn({ err: error, counts }, 'run failed');
  }

  // Phase 3: finalise.
  const status = error ? 'failed' : 'succeeded';
  const final = await db.transaction(async (tx) => {
    const [updated] = await tx.update(migrationRuns).set({ status, counts, error, finishedAt: new Date() })
      .where(eq(migrationRuns.id, run.id)).returning();
    await recordEvent(tx, { workspaceId, type: error ? 'execution.failed' : 'execution.succeeded', actor: input.actor,
      subjectType: 'migration_run', subjectId: run.id, payload: { kind: run.kind, attempt: run.attempt, counts, error } });
    return updated;
  });
  return toDto(final);
}

export async function listRuns(workspaceId: string): Promise<MigrationRunDto[]> {
  await getWorkspace(workspaceId);
  const rows = await db.select().from(migrationRuns).where(eq(migrationRuns.workspaceId, workspaceId)).orderBy(desc(migrationRuns.startedAt), desc(migrationRuns.attempt));
  return Promise.all(rows.map(toDto));
}
