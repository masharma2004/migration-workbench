import type { VersionContent } from '@/domain/plan';
import type { SourceRecordInput } from '@/domain/types';
import { checkEvidence, draftToContent } from './draft';
import type { LLMMessage, LLMProvider, LLMTurn, ToolCall } from './llm/types';
import { SYSTEM_PROMPT } from './prompts';
import { ALLOWED_TOOLS, isAllowedTool, runTool, TOOL_DECLS, ToolArgError } from './tools';

export interface AgentStepRecord {
  step: number;
  kind: 'tool_call' | 'model_text' | 'correction' | 'error';
  toolName: string | null;
  args: unknown;
  result: unknown;
  durationMs: number;
}
export interface AgentLimits { maxToolCalls: number; maxDurationMs: number; maxCorrections: number; maxNudges: number }
export const DEFAULT_LIMITS: AgentLimits = { maxToolCalls: 15, maxDurationMs: 90_000, maxCorrections: 2, maxNudges: 1 };
type Usage = { inputTokens: number; outputTokens: number };
export type AgentOutcome =
  | { status: 'succeeded'; content: VersionContent; usage: Usage; toolCalls: number }
  | { status: 'failed'; error: string; usage: Usage; toolCalls: number };

const MAX_RESULT_CHARS = 12_000;
function truncate(result: unknown): unknown {
  const text = JSON.stringify(result);
  return text.length <= MAX_RESULT_CHARS ? result : { truncated: true, preview: text.slice(0, MAX_RESULT_CHARS) };
}

class BudgetError extends Error {}

export async function runAgentLoop(opts: {
  provider: LLMProvider;
  records: SourceRecordInput[];
  prompt: string;
  limits?: Partial<AgentLimits>;
  onStep: (s: AgentStepRecord) => Promise<void>;
}): Promise<AgentOutcome> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.maxDurationMs);
  const session = opts.provider.startSession({ system: SYSTEM_PROMPT, tools: TOOL_DECLS });
  const validStepIds = new Set<number>();
  let step = 0, toolCalls = 0, corrections = 0, nudges = 0;

  const record = async (s: Omit<AgentStepRecord, 'step'>) => {
    step += 1;
    await opts.onStep({ step, ...s });
    return step;
  };
  const send = async (message: LLMMessage): Promise<LLMTurn> => {
    if (controller.signal.aborted) throw new BudgetError(`Agent exceeded its time budget of ${limits.maxDurationMs / 1000}s`);
    try {
      const turn = await session.send(message, controller.signal);
      usage.inputTokens += turn.usage.inputTokens;
      usage.outputTokens += turn.usage.outputTokens;
      return turn;
    } catch (err) {
      if (controller.signal.aborted) throw new BudgetError(`Agent exceeded its time budget of ${limits.maxDurationMs / 1000}s`);
      throw err;
    }
  };
  const fail = (error: string): AgentOutcome => ({ status: 'failed', error, usage, toolCalls });

  try {
    let turn = await send({ text: opts.prompt });
    for (;;) {
      if (turn.text) await record({ kind: 'model_text', toolName: null, args: null, result: { text: turn.text.slice(0, 4000) }, durationMs: 0 });
      if (!turn.calls.length) {
        if (nudges >= limits.maxNudges) return fail('Agent stopped without submitting a plan draft');
        nudges += 1;
        turn = await send({ text: 'You must finish by calling submit_plan_draft with the complete draft plan.' });
        continue;
      }

      const results: { call: ToolCall; result: unknown }[] = [];
      for (const call of turn.calls) {
        toolCalls += 1;
        if (toolCalls > limits.maxToolCalls) return fail(`Agent exceeded its tool-call budget of ${limits.maxToolCalls}`);

        if (!isAllowedTool(call.name)) {
          const error = `Tool "${call.name}" is not available. Allowed tools: ${ALLOWED_TOOLS.join(', ')}`;
          const id = await record({ kind: 'error', toolName: call.name, args: call.args, result: { error }, durationMs: 0 });
          results.push({ call, result: { stepId: id, error } });
          continue;
        }

        if (call.name === 'submit_plan_draft') {
          const { content, issues } = draftToContent(call.args);
          const allIssues = content ? [...issues, ...checkEvidence(content, validStepIds)] : issues;
          if (content && !allIssues.length) {
            await record({ kind: 'tool_call', toolName: call.name, args: { summary: content.summary }, result: { accepted: true }, durationMs: 0 });
            return { status: 'succeeded', content, usage, toolCalls };
          }
          const id = await record({ kind: 'correction', toolName: call.name, args: null, result: { accepted: false, issues: allIssues }, durationMs: 0 });
          if (corrections >= limits.maxCorrections) {
            return fail(`Draft still invalid after ${limits.maxCorrections} corrections: ${allIssues.slice(0, 5).map((i) => i.message).join('; ')}`);
          }
          corrections += 1;
          results.push({ call, result: { stepId: id, accepted: false, issues: allIssues, instruction: 'Fix every issue and call submit_plan_draft again.' } });
          continue;
        }

        const t0 = Date.now();
        try {
          const output = truncate(runTool(call.name, call.args, { records: opts.records }));
          const id = await record({ kind: 'tool_call', toolName: call.name, args: call.args, result: output, durationMs: Date.now() - t0 });
          validStepIds.add(id);
          results.push({ call, result: { stepId: id, ...((typeof output === 'object' && output) || { value: output }) } });
        } catch (err) {
          const error = err instanceof ToolArgError ? `Invalid arguments: ${err.message}` : `Tool failed: ${(err as Error).message}`;
          const id = await record({ kind: 'error', toolName: call.name, args: call.args, result: { error }, durationMs: Date.now() - t0 });
          results.push({ call, result: { stepId: id, error } });
        }
      }
      turn = await send({ toolResults: results });
    }
  } catch (err) {
    if (err instanceof BudgetError) return fail(err.message);
    return fail((err as Error).message ?? 'Agent failed');
  } finally {
    clearTimeout(timer);
  }
}
