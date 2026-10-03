import { inArray } from 'drizzle-orm';
import { db } from './db/client';
import { runMigrations } from './db/migrate';
import { agentRuns } from './db/schema';
import { logger } from './log';
import { recordEvent } from './services/audit';
import { markInterruptedRuns } from './services/executions';

export async function runStartupTasks(): Promise<void> {
  const log = logger.child({ component: 'startup' });
  if (process.env.SKIP_MIGRATIONS !== '1') {
    await runMigrations();
    log.info('database migrations applied');
  }
  const failed = await db.update(agentRuns)
    .set({ status: 'failed', error: 'Interrupted by server restart', finishedAt: new Date() })
    .where(inArray(agentRuns.status, ['queued', 'running'])).returning({ id: agentRuns.id, workspaceId: agentRuns.workspaceId });
  for (const r of failed) {
    await recordEvent(db, { workspaceId: r.workspaceId, type: 'agent_run.failed', actor: 'system', subjectType: 'agent_run',
      subjectId: r.id, payload: { error: 'Interrupted by server restart' } });
  }
  const interrupted = await markInterruptedRuns(db);
  log.info({ agentRunsFailed: failed.length, migrationRunsInterrupted: interrupted }, 'startup recovery complete');
}
