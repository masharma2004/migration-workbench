import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { migrationRuns, targetCustomers } from '@/server/db/schema';
import { approveVersion } from '@/server/services/approvals';
import { listEvents } from '@/server/services/audit';
import { runDryRun } from '@/server/services/dry-runs';
import { executeMigration, listRuns, markInterruptedRuns } from '@/server/services/executions';
import { createVersion } from '@/server/services/plans';
import { rollbackMigration } from '@/server/services/rollback';
import { REFERENCE_PLAN } from '@/seed/reference-plan';
import { approvedWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

const migratedCount = async (ws: string) => (await db.select().from(targetCustomers)
  .where(and(eq(targetCustomers.workspaceId, ws), eq(targetCustomers.origin, 'migrated')))).length;
const distinctLegacy = async (ws: string) => (await db.execute<{ n: number }>(sql`
  select count(distinct legacy_id)::int as n from target.customers where _workspace_id = ${ws} and _origin = 'migrated'`))[0].n;

describe('executeMigration', () => {
  it('refuses without an approved version', async () => {
    const ws = await approvedWorkspace({ approve: false });
    await expect(executeMigration(ws, { actor: 'u' })).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  });

  it('inserts all accepted rows in batches and records history', async () => {
    const ws = await approvedWorkspace();
    const run = await executeMigration(ws, { actor: 'u' });
    expect(run).toMatchObject({ kind: 'execute', attempt: 1, status: 'succeeded',
      counts: { planned: 177, inserted: 177, alreadyPresent: 0, conflict: 0, batchesCommitted: 4 } });
    expect(await migratedCount(ws)).toBe(177);
    const types = (await listEvents(ws)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['execution.started', 'execution.succeeded']));
  });

  it('a simulated mid-run failure keeps committed batches; retry finishes with zero duplicates', async () => {
    const ws = await approvedWorkspace();
    const failed = await executeMigration(ws, { actor: 'u', failAfterBatches: 2 });
    expect(failed).toMatchObject({ status: 'failed', counts: { inserted: 100, batchesCommitted: 2 } });
    expect(failed.error).toMatch(/Simulated failure after 2 batches/);
    expect(await migratedCount(ws)).toBe(100);

    const retry = await executeMigration(ws, { actor: 'u' });
    expect(retry).toMatchObject({ kind: 'retry', attempt: 2, parentRunId: failed.id, status: 'succeeded',
      counts: { planned: 177, inserted: 77, alreadyPresent: 100, conflict: 0 } });
    const again = await executeMigration(ws, { actor: 'u' });
    expect(again.counts).toMatchObject({ inserted: 0, alreadyPresent: 177 });
    expect(await migratedCount(ws)).toBe(177);
    expect(await distinctLegacy(ws)).toBe(177);
  });

  it('allows only one concurrent run per workspace', async () => {
    const ws = await approvedWorkspace();
    const results = await Promise.allSettled([executeMigration(ws, { actor: 'a' }), executeMigration(ws, { actor: 'b' })]);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // Either the second waits and becomes a no-op retry, or it is refused while the first runs.
    if (rejected.length) {
      expect(rejected[0].reason).toMatchObject({ code: 'RUN_IN_PROGRESS' });
      expect(fulfilled).toHaveLength(1);
    }
    expect(await distinctLegacy(ws)).toBe(177);
    expect(await migratedCount(ws)).toBe(177);
  });

  it('marks stuck running runs as interrupted, and a retry then completes (review focus 5)', async () => {
    const ws = await approvedWorkspace();
    const failed = await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    await db.update(migrationRuns).set({ status: 'running' }).where(eq(migrationRuns.id, failed.id)); // simulate crash
    expect(await markInterruptedRuns(db, ws)).toBe(1);
    const retry = await executeMigration(ws, { actor: 'u' });
    expect(retry.counts).toMatchObject({ inserted: 127, alreadyPresent: 50 });
    expect((await listRuns(ws))[1].status).toBe('interrupted');
  });

  it('never takes over a long-running run while the process is alive (review #1)', async () => {
    const ws = await approvedWorkspace();
    const run = await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    await db.update(migrationRuns).set({ status: 'running', startedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(migrationRuns.id, run.id));
    await expect(executeMigration(ws, { actor: 'u' })).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });
  });

  it('refuses a different plan version until the active migration is rolled back', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    const edited = structuredClone(REFERENCE_PLAN);
    edited.mappings.find((m) => m.targetField === 'is_vip')!.rationale = 'v2';
    edited.mappings.find((m) => m.targetField === 'marketing_opt_in')!.transforms = [{ rule: 'default_value', params: { value: true } }];
    await createVersion(db, { workspaceId: ws, content: { plan: edited }, author: 'user', actor: 'u' });
    await runDryRun(ws, 2, 'u');
    await approveVersion(ws, 2, { approvedBy: 'R', acknowledgeDryRun: true });
    await expect(executeMigration(ws, { actor: 'u' })).rejects.toMatchObject({ code: 'ROLLBACK_REQUIRED' });
    await rollbackMigration(ws, 'u');
    const run = await executeMigration(ws, { actor: 'u' });
    expect(run).toMatchObject({ version: 2, kind: 'execute', counts: { inserted: 177 } });
  });

  it('refuses when the approved dry-run report no longer matches (APPROVAL_STALE)', async () => {
    const ws = await approvedWorkspace();
    // A new pre-existing customer appears in the target and collides with a source email → report changes.
    await db.execute(sql`insert into target.customers (first_name, email, created_on, status, lifetime_value_cents, is_vip,
      marketing_opt_in, _workspace_id, _origin, _row_hash)
      select 'New', email, '2024-01-01', 'active', 0, false, false, ${ws}, 'preexisting', 'x'
      from (select lower(raw->>'email') as email from app.source_records where workspace_id = ${ws} and seq = 1) s`);
    await expect(executeMigration(ws, { actor: 'u' })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
  });
});

describe('rollbackMigration', () => {
  it('removes only migrated rows of active runs, leaves pre-existing rows, and is not repeatable', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    await executeMigration(ws, { actor: 'u' });
    const rb = await rollbackMigration(ws, 'u');
    expect(rb.rowsDeleted).toBe(177);
    expect(rb.runIds).toHaveLength(2);
    expect(await migratedCount(ws)).toBe(0);
    const pre = await db.select().from(targetCustomers).where(and(eq(targetCustomers.workspaceId, ws), eq(targetCustomers.origin, 'preexisting')));
    expect(pre).toHaveLength(8);
    expect((await listRuns(ws)).every((r) => r.status === 'rolled_back')).toBe(true);
    await expect(rollbackMigration(ws, 'u')).rejects.toMatchObject({ code: 'NOTHING_TO_ROLLBACK' });
    expect((await listEvents(ws)).map((e) => e.type)).toContain('rollback.completed');
  });
});
