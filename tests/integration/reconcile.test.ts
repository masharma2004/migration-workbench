import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { migrationRuns, targetCustomers } from '@/server/db/schema';
import { executeMigration } from '@/server/services/executions';
import { listReconciliations, runReconciliation } from '@/server/services/reconciliations';
import { rollbackMigration } from '@/server/services/rollback';
import { approvedWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('runReconciliation', () => {
  it('passes after a complete migration', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    const r = await runReconciliation(ws, 'u');
    expect(r).toMatchObject({ version: 1, result: 'pass' });
    expect(r.details.checks.find((c) => c.id === 'row_count')).toMatchObject({ expected: 177, actual: 177 });
  });

  it('fails after a partial run and passes after retry', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    const partial = await runReconciliation(ws, 'u');
    expect(partial.result).toBe('fail');
    expect(partial.details.missing).toHaveLength(127);
    await executeMigration(ws, { actor: 'u' });
    expect((await runReconciliation(ws, 'u')).result).toBe('pass');
  });

  it('detects a tampered target row', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    await db.execute(sql`update target.customers set lifetime_value_cents = lifetime_value_cents + 1
      where _workspace_id = ${ws} and legacy_id = 'C-00001'`);
    const r = await runReconciliation(ws, 'u');
    expect(r.result).toBe('fail');
    expect(r.details.mismatched.map((m) => m.legacyId)).toEqual(['C-00001']);
  });

  it('refuses to reconcile while a run is in progress (review #9)', async () => {
    const ws = await approvedWorkspace();
    const run = await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    await db.update(migrationRuns).set({ status: 'running' }).where(eq(migrationRuns.id, run.id));
    await expect(runReconciliation(ws, 'u')).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });
  });

  it('passes with a clean target after rollback and keeps history', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    await rollbackMigration(ws, 'u');
    const r = await runReconciliation(ws, 'u');
    expect(r).toMatchObject({ result: 'pass', version: null });
    expect(r.details.activeMigration).toBe(false);
    const left = await db.select().from(targetCustomers).where(and(eq(targetCustomers.workspaceId, ws), eq(targetCustomers.origin, 'migrated')));
    expect(left).toHaveLength(0);
    expect(await listReconciliations(ws)).toHaveLength(1);
  });
});
