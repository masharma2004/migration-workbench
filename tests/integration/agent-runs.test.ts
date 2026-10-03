import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider } from '@/server/agent/llm/mock';
import { referenceScript } from '@/server/agent/reference-script';
import { closeDb, db } from '@/server/db/client';
import { getAgentRun, startAgentRun } from '@/server/services/agent-runs';
import { listEvents } from '@/server/services/audit';
import { createVersion, getVersion } from '@/server/services/plans';
import { REFERENCE_DRAFT } from '@/seed/reference-draft';
import { createTestWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('agent runs', () => {
  it('stores a succeeded run, its trace, and a new agent-authored draft version', async () => {
    const ws = await createTestWorkspace();
    const { runId } = await startAgentRun(ws, { mode: 'propose' }, 'tester',
      { provider: new MockProvider(referenceScript()), background: false });
    const run = await getAgentRun(ws, runId);
    expect(run).toMatchObject({ status: 'succeeded', resultVersion: 1, toolCalls: 7, model: 'mock-scripted' });
    expect(run.steps).toHaveLength(7);
    const v = await getVersion(ws, 1);
    expect(v).toMatchObject({ author: 'agent', status: 'draft', agentRunId: runId });
    expect(v.content.questions.filter((q) => q.blocking)).toHaveLength(2);
    const types = (await listEvents(ws)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['agent_run.started', 'agent_run.succeeded', 'plan.version_created']));
  });

  it('records a failed run without creating a version', async () => {
    const ws = await createTestWorkspace();
    const { runId } = await startAgentRun(ws, { mode: 'propose' }, 't',
      { provider: new MockProvider([{ text: 'a' }, { text: 'b' }]), background: false });
    expect(await getAgentRun(ws, runId)).toMatchObject({ status: 'failed', resultVersion: null });
    expect((await listEvents(ws)).map((e) => e.type)).toContain('agent_run.failed');
  });

  it('revise mode keeps reviewer answers even if the model drops them', async () => {
    const ws = await createTestWorkspace();
    await startAgentRun(ws, { mode: 'propose' }, 't', { provider: new MockProvider(referenceScript()), background: false });
    const script = referenceScript();
    const { runId } = await startAgentRun(ws, { mode: 'revise', baseVersion: 1, answers: { 'q-date-order': 'Month-first (US)' } }, 't',
      { provider: new MockProvider(script), background: false });
    const run = await getAgentRun(ws, runId);
    expect(run.resultVersion).toBe(2);
    const v2 = await getVersion(ws, 2);
    expect(v2.parentVersionId).toBe((await getVersion(ws, 1)).id);
    expect(v2.content.questions.find((q) => q.id === 'q-date-order')?.answer).toBe('Month-first (US)');
    expect(REFERENCE_DRAFT.questions?.find((q) => (q as { id: string }).id === 'q-date-order')).not.toHaveProperty('answer');
  });

  it('fails fast with LLM_UNAVAILABLE when no provider is configured', async () => {
    const ws = await createTestWorkspace();
    await expect(startAgentRun(ws, { mode: 'propose' }, 't', { provider: null })).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });

  it('requires baseVersion in revise mode', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: { plan: (await import('@/seed/reference-plan')).REFERENCE_PLAN }, author: 'user', actor: 't' });
    await expect(startAgentRun(ws, { mode: 'revise' }, 't', { provider: new MockProvider([]) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
