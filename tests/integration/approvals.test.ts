import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { approveVersion, getCurrentApproval, getReadiness } from '@/server/services/approvals';
import { listEvents } from '@/server/services/audit';
import { runDryRun } from '@/server/services/dry-runs';
import { createVersion, getVersion } from '@/server/services/plans';
import { REFERENCE_PLAN } from '@/seed/reference-plan';
import { createTestWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

const blockingQ = (answer?: string) => ({ id: 'q-date', text: 'US or EU dates?', blocking: true, relatedFields: ['signup_date'],
  suggestedOptions: ['US', 'EU'], assumption: 'US', ...(answer ? { answer } : {}) });
const content = (questions: unknown[] = []) => ({ plan: REFERENCE_PLAN, risks: [], incompatibilities: [], questions, summary: '' });
const approve = (ws: string, v: number) => approveVersion(ws, v, { approvedBy: 'Reviewer', acknowledgeDryRun: true });

describe('readiness', () => {
  it('requires a valid plan, answered blocking questions and a current dry run', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: content([blockingQ()]), author: 'agent', actor: 'agent' });
    let r = await getReadiness(ws, 1);
    expect(r.ready).toBe(false);
    expect(Object.fromEntries(r.checks.map((c) => [c.id, c.passed]))).toEqual({
      plan_valid: true, blocking_questions_answered: false, dry_run_current: false });

    await createVersion(db, { workspaceId: ws, content: content([blockingQ('US')]), author: 'user', actor: 'u' });
    await runDryRun(ws, 2, 'u');
    r = await getReadiness(ws, 2);
    expect(r.ready).toBe(true);
    expect(r.latestDryRun?.counts.accepted).toBe(177);
  });
});

describe('approveVersion', () => {
  it('refuses when not ready, or without acknowledgement', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 'u' });
    await expect(approve(ws, 1)).rejects.toMatchObject({ code: 'NOT_READY' });
    await runDryRun(ws, 1, 'u');
    await expect(approveVersion(ws, 1, { approvedBy: 'R', acknowledgeDryRun: false })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(approveVersion(ws, 1, { approvedBy: '  ', acknowledgeDryRun: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('binds approval to hashes and supersedes the previously approved version', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 'u' });
    await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 'u' });
    await runDryRun(ws, 1, 'u');
    await runDryRun(ws, 2, 'u');
    const a1 = await approve(ws, 1);
    expect(a1).toMatchObject({ version: 1, approvedBy: 'Reviewer', targetSchemaVersion: 'target-v1' });
    await approve(ws, 2);
    expect((await getVersion(ws, 1)).status).toBe('superseded');
    expect((await getVersion(ws, 2)).status).toBe('approved');
    expect((await getCurrentApproval(db, ws))?.version.version).toBe(2);
    const types = (await listEvents(ws)).map((e) => e.type);
    expect(types.filter((t) => t === 'plan.approved')).toHaveLength(2);
    expect(types).toContain('plan.superseded');
  });
});
