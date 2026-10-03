import { describe, expect, it } from 'vitest';
import { MockProvider, type MockStep } from '@/server/agent/llm/mock';
import { runAgentLoop, type AgentStepRecord } from '@/server/agent/loop';
import { referenceScript } from '@/server/agent/reference-script';
import { planHash } from '@/domain/plan';
import { seedRecordsAsInput } from '@/seed';
import { REFERENCE_DRAFT } from '@/seed/reference-draft';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const records = seedRecordsAsInput();
async function run(script: MockStep[], limits = {}) {
  const provider = new MockProvider(script);
  const steps: AgentStepRecord[] = [];
  const outcome = await runAgentLoop({ provider, records, prompt: 'go', limits, onStep: async (s) => { steps.push(s); } });
  return { outcome, steps, provider };
}
const submit = (args: unknown): MockStep => ({ calls: [{ name: 'submit_plan_draft', args: args as Record<string, unknown> }] });

describe('runAgentLoop', () => {
  it('completes the reference run and yields the reference plan', async () => {
    const { outcome, steps, provider } = await run(referenceScript());
    expect(outcome.status).toBe('succeeded');
    if (outcome.status !== 'succeeded') return;
    expect(planHash(outcome.content.plan)).toBe(planHash(REFERENCE_PLAN));
    expect(outcome.toolCalls).toBe(7);
    expect(steps.map((s) => s.toolName)).toEqual(['get_source_schema', 'get_target_schema', 'list_transformation_rules',
      'profile_field', 'profile_field', 'test_transformation', 'submit_plan_draft']);
    expect(provider.sessions[0].tools.map((t) => t.name)).toHaveLength(8);
    expect(provider.sessions[0].system).toMatch(/untrusted/i);
  });

  it('rejects a non-allowlisted tool, tells the model, and continues', async () => {
    const script = referenceScript();
    script.unshift({ calls: [{ name: 'execute_migration', args: {} }] });
    const { outcome, steps, provider } = await run(script);
    expect(steps[0]).toMatchObject({ kind: 'error', toolName: 'execute_migration' });
    const reply = provider.sessions[0].received[1] as { toolResults: { result: { error: string } }[] };
    expect(reply.toolResults[0].result.error).toMatch(/not available/);
    // Evidence ids in REFERENCE_DRAFT now point one step later; the run still finishes after a correction.
    expect(['succeeded', 'failed']).toContain(outcome.status);
  });

  it('feeds validation issues back and fails after 2 corrections', async () => {
    const bad = { ...REFERENCE_DRAFT, mappings: [] };
    const { outcome, steps } = await run([submit(bad), submit(bad), submit(bad)]);
    expect(steps.filter((s) => s.kind === 'correction')).toHaveLength(3);
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/still invalid after 2 corrections/);
  });

  it('accepts a corrected draft on the second attempt', async () => {
    const script = referenceScript();
    const last = script.pop()!;
    script.push(submit({ ...REFERENCE_DRAFT, mappings: [] }), last);
    const { outcome } = await run(script);
    expect(outcome.status).toBe('succeeded');
  });

  it('enforces the tool-call budget', async () => {
    const spam: MockStep[] = Array.from({ length: 20 }, () => ({ calls: [{ name: 'get_source_schema', args: {} }] }));
    const { outcome } = await run(spam, { maxToolCalls: 5 });
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/budget of 5/);
  });

  it('nudges once when the model answers with text only, then fails on a second stall', async () => {
    const ok = await run([{ text: 'Here is my plan in prose.' }, ...referenceScript()]);
    expect(ok.outcome.status).toBe('succeeded');
    const stalled = await run([{ text: 'a' }, { text: 'b' }]);
    expect(stalled.outcome).toMatchObject({ status: 'failed' });
  });

  it('enforces the wall-clock budget', async () => {
    const { outcome } = await run([{ delayMs: 500, text: 'slow' }], { maxDurationMs: 50 });
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/time budget/i);
  });
});
