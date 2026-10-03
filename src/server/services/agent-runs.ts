import { and, asc, desc, eq } from 'drizzle-orm';
import type { Question, VersionContent } from '@/domain/plan';
import { runAgentLoop, type AgentLimits, type AgentStepRecord } from '../agent/loop';
import type { LLMProvider } from '../agent/llm/types';
import { buildProposePrompt, buildRevisePrompt } from '../agent/prompts';
import { getProvider } from '../agent/provider';
import { db } from '../db/client';
import { agentRuns, agentSteps, planVersions } from '../db/schema';
import { AppError, notFound } from '../errors';
import { logger } from '../log';
import { recordEvent } from './audit';
import { loadDataset } from './dataset';
import { createVersion, getVersion } from './plans';
import { getWorkspace } from './workspaces';

export interface AgentRunDto {
  id: string; mode: 'propose' | 'revise'; status: 'queued' | 'running' | 'succeeded' | 'failed'; error: string | null;
  model: string; inputTokens: number; outputTokens: number; toolCalls: number; resultVersion: number | null;
  startedAt: string; finishedAt: string | null; steps: AgentStepRecord[];
}

export function applyAnswers(content: VersionContent, answers: Record<string, string>): VersionContent {
  return { ...content, questions: content.questions.map((q) => (answers[q.id]?.trim() ? { ...q, answer: answers[q.id].trim() } : q)) };
}

/** Reviewer answers are authoritative: re-attach them if the model dropped or blanked them. */
export function mergeAnsweredQuestions(base: Question[], next: Question[]): Question[] {
  const merged = next.map((q) => {
    const prior = base.find((b) => b.id === q.id && b.answer?.trim());
    return prior && !q.answer?.trim() ? { ...q, answer: prior.answer } : q;
  });
  for (const b of base) if (b.answer?.trim() && !merged.some((q) => q.id === b.id)) merged.push(b);
  return merged;
}

export async function startAgentRun(
  workspaceId: string,
  input: { mode: 'propose' | 'revise'; baseVersion?: number; answers?: Record<string, string>; instructions?: string },
  actor: string,
  deps: { provider?: LLMProvider | null; background?: boolean; limits?: Partial<AgentLimits> } = {},
): Promise<{ runId: string }> {
  await getWorkspace(workspaceId);
  const provider = deps.provider === undefined ? getProvider() : deps.provider;
  if (!provider) throw new AppError('LLM_UNAVAILABLE', 'The AI agent is not configured (missing GEMINI_API_KEY). You can still author plans manually.');
  if (input.mode === 'revise' && !input.baseVersion) throw new AppError('VALIDATION_ERROR', 'baseVersion is required to revise a plan');
  const base = input.mode === 'revise' ? await getVersion(workspaceId, input.baseVersion!) : null;

  const [run] = await db.insert(agentRuns).values({
    workspaceId, mode: input.mode, basePlanVersionId: base?.id ?? null, status: 'queued', model: provider.model,
    input: { answers: input.answers ?? {}, instructions: input.instructions ?? null, baseVersion: input.baseVersion ?? null },
  }).returning();
  await recordEvent(db, { workspaceId, type: 'agent_run.started', actor, subjectType: 'agent_run', subjectId: run.id,
    payload: { mode: input.mode, baseVersion: input.baseVersion ?? null, model: provider.model } });

  const job = processAgentRun(run.id, workspaceId, provider, base?.content ?? null, base?.id ?? null, input, actor, deps.limits);
  if (deps.background === false) await job;
  else void job;
  return { runId: run.id };
}

async function processAgentRun(runId: string, workspaceId: string, provider: LLMProvider, baseContent: VersionContent | null,
  baseId: string | null, input: { answers?: Record<string, string>; instructions?: string }, actor: string, limits?: Partial<AgentLimits>) {
  const log = logger.child({ component: 'agent', workspaceId, agentRunId: runId, model: provider.model });
  try {
    await db.update(agentRuns).set({ status: 'running' }).where(eq(agentRuns.id, runId));
    const { records } = await loadDataset(db, workspaceId);
    const answeredBase = baseContent ? applyAnswers(baseContent, input.answers ?? {}) : null;
    const prompt = answeredBase ? buildRevisePrompt(answeredBase, input.instructions) : buildProposePrompt(records.length);
    const outcome = await runAgentLoop({ provider, records, prompt, limits, onStep: async (s) => {
      await db.insert(agentSteps).values({ agentRunId: runId, step: s.step, kind: s.kind, toolName: s.toolName,
        args: s.args as object, result: s.result as object, durationMs: s.durationMs });
      log.info({ step: s.step, kind: s.kind, tool: s.toolName, durationMs: s.durationMs }, 'agent step');
    } });

    await db.transaction(async (tx) => {
      const common = { inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens, toolCalls: outcome.toolCalls, finishedAt: new Date() };
      if (outcome.status === 'succeeded') {
        const content = answeredBase
          ? { ...outcome.content, questions: mergeAnsweredQuestions(answeredBase.questions, outcome.content.questions) }
          : outcome.content;
        const version = await createVersion(tx, { workspaceId, content, author: 'agent', parentVersionId: baseId, agentRunId: runId,
          changeNote: baseId ? 'Agent revision' : 'Agent proposal', actor: 'agent' });
        await tx.update(agentRuns).set({ ...common, status: 'succeeded', resultPlanVersionId: version.id }).where(eq(agentRuns.id, runId));
        await recordEvent(tx, { workspaceId, type: 'agent_run.succeeded', actor, subjectType: 'agent_run', subjectId: runId,
          payload: { version: version.version, toolCalls: outcome.toolCalls, ...outcome.usage } });
      } else {
        await tx.update(agentRuns).set({ ...common, status: 'failed', error: outcome.error }).where(eq(agentRuns.id, runId));
        await recordEvent(tx, { workspaceId, type: 'agent_run.failed', actor, subjectType: 'agent_run', subjectId: runId,
          payload: { error: outcome.error, toolCalls: outcome.toolCalls } });
      }
    });
    log.info({ status: outcome.status, toolCalls: outcome.toolCalls, ...outcome.usage }, 'agent run finished');
  } catch (err) {
    log.error({ err }, 'agent run crashed');
    await db.update(agentRuns).set({ status: 'failed', error: 'Internal error while running the agent', finishedAt: new Date() }).where(eq(agentRuns.id, runId));
    await recordEvent(db, { workspaceId, type: 'agent_run.failed', actor, subjectType: 'agent_run', subjectId: runId, payload: { error: 'internal' } });
  }
}

type RunRow = typeof agentRuns.$inferSelect;
async function toDto(r: RunRow): Promise<Omit<AgentRunDto, 'steps'>> {
  const [v] = r.resultPlanVersionId
    ? await db.select({ version: planVersions.version }).from(planVersions).where(eq(planVersions.id, r.resultPlanVersionId))
    : [];
  return { id: r.id, mode: r.mode, status: r.status, error: r.error, model: r.model, inputTokens: r.inputTokens,
    outputTokens: r.outputTokens, toolCalls: r.toolCalls, resultVersion: v?.version ?? null,
    startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null };
}

export async function getAgentRun(workspaceId: string, runId: string): Promise<AgentRunDto> {
  const [r] = await db.select().from(agentRuns).where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.id, runId)));
  if (!r) throw notFound('Agent run');
  const steps = await db.select().from(agentSteps).where(eq(agentSteps.agentRunId, runId)).orderBy(asc(agentSteps.step));
  return { ...(await toDto(r)), steps: steps.map((s) => ({ step: s.step, kind: s.kind, toolName: s.toolName, args: s.args, result: s.result, durationMs: s.durationMs })) };
}

export async function listAgentRuns(workspaceId: string) {
  await getWorkspace(workspaceId);
  const rows = await db.select().from(agentRuns).where(eq(agentRuns.workspaceId, workspaceId)).orderBy(desc(agentRuns.startedAt));
  return Promise.all(rows.map(toDto));
}
