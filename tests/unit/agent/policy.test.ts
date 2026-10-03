import { describe, expect, it } from 'vitest';
import { collectSignals, enforceReviewPolicy } from '@/server/agent/policy';
import { draftToContent } from '@/server/agent/draft';
import { REFERENCE_DRAFT } from '@/seed/reference-draft';

const base = () => draftToContent(REFERENCE_DRAFT).content!;

describe('enforceReviewPolicy', () => {
  it('removes answers the model wrote for itself (answers come only from humans)', () => {
    const c = base();
    c.questions = c.questions.map((q) => ({ ...q, answer: 'model decided' }));
    expect(enforceReviewPolicy(c, { ambiguousDateFields: [] }).questions.every((q) => q.answer === undefined)).toBe(true);
  });

  it('makes questions about defaulted required fields and ambiguous dates blocking', () => {
    const c = base();
    c.questions = c.questions.map((q) => ({ ...q, blocking: false }));
    const out = enforceReviewPolicy(c, { ambiguousDateFields: ['signup_date'] });
    const blocking = out.questions.filter((q) => q.blocking).map((q) => q.id).sort();
    expect(blocking).toEqual(['q-date-order', 'q-marketing-consent']);
  });

  it('adds a labelled system question when the agent did not ask about a policy field', () => {
    const c = base();
    c.questions = [];
    const out = enforceReviewPolicy(c, { ambiguousDateFields: ['signup_date'] });
    expect(out.questions.map((q) => q.id).sort()).toEqual(['sys-ambiguous-signup_date', 'sys-default-marketing_opt_in']);
    expect(out.questions.every((q) => q.blocking && q.text.startsWith('[System check]'))).toBe(true);
  });
});

describe('collectSignals', () => {
  it('detects ambiguous dates from profile patterns and transformation warnings', () => {
    expect(collectSignals([
      { toolName: 'profile_field', args: { fields: ['status', 'signup_date'] }, result: { profiles: [
        { field: 'status', patterns: [{ pattern: 'A' }] },
        { field: 'signup_date', patterns: [{ pattern: '99/99/9999 [ambiguous: both parts <= 12]' }] }] } },
      { toolName: 'test_transformation', args: { sourceField: 'other_date' }, result: { warnings: [{ code: 'AMBIGUOUS_DATE' }] } },
    ])).toEqual({ ambiguousDateFields: ['other_date', 'signup_date'] });
  });
});
