import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { approveVersion } from '@/server/services/approvals';
import { runDryRun } from '@/server/services/dry-runs';
import { createVersion } from '@/server/services/plans';
import { createWorkspace } from '@/server/services/workspaces';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

export async function resetDatabase(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.allow_audit_delete = 'on'`);
    await tx.execute(sql`TRUNCATE app.workspaces, target.customers CASCADE`);
  });
}

export async function createTestWorkspace(): Promise<string> {
  return (await createWorkspace()).id;
}

/** Workspace with reference plan v1, a dry run, and (by default) an approval. */
export async function approvedWorkspace(opts: { approve?: boolean } = {}): Promise<string> {
  const ws = await createTestWorkspace();
  await createVersion(db, { workspaceId: ws, content: { plan: REFERENCE_PLAN }, author: 'user', actor: 'test' });
  await runDryRun(ws, 1, 'test');
  if (opts.approve !== false) await approveVersion(ws, 1, { approvedBy: 'Test Reviewer', acknowledgeDryRun: true });
  return ws;
}
