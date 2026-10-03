import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { agentRuns, migrationRuns } from '@/server/db/schema';
import { executeMigration } from '@/server/services/executions';
import { runStartupTasks } from '@/server/startup';
import { approvedWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('runStartupTasks (review focus 5)', () => {
  it('fails orphaned agent runs and interrupts orphaned migration runs', async () => {
    const ws = await approvedWorkspace();
    const [agent] = await db.insert(agentRuns).values({ workspaceId: ws, mode: 'propose', status: 'running', model: 'x' }).returning();
    const run = await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    await db.update(migrationRuns).set({ status: 'running' }).where(eq(migrationRuns.id, run.id));
    process.env.SKIP_MIGRATIONS = '1';
    await runStartupTasks();
    const [a] = await db.select().from(agentRuns).where(eq(agentRuns.id, agent.id));
    const [m] = await db.select().from(migrationRuns).where(eq(migrationRuns.id, run.id));
    expect(a).toMatchObject({ status: 'failed', error: 'Interrupted by server restart' });
    expect(m.status).toBe('interrupted');
  });
});
