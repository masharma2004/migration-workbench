import { describe, expect, it } from 'vitest';
import { dryRun } from '@/domain/engine';
import { MAX_SOURCE_RECORDS } from '@/domain/limits';
import { SEED_ISSUES, SEED_PREEXISTING_TARGET, SEED_SOURCE_RECORDS, seedRecordsAsInput } from '@/seed';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const report = dryRun({
  records: seedRecordsAsInput(),
  plan: REFERENCE_PLAN,
  preexistingEmails: SEED_PREEXISTING_TARGET.map((r) => String(r.email)),
});

describe('seed dataset', () => {
  it('has 200 records (within the documented maximum) and 8 pre-existing target rows', () => {
    expect(SEED_SOURCE_RECORDS).toHaveLength(200);
    expect(SEED_SOURCE_RECORDS.length).toBeLessThanOrEqual(MAX_SOURCE_RECORDS);
    expect(SEED_PREEXISTING_TARGET).toHaveLength(8);
  });

  it('produces the documented reference-plan totals', () => {
    expect(report.counts).toEqual({
      source: 200, transformed: 184, accepted: 177, rejected: 23,
      rejectedByStage: { TRANSFORM_ERROR: 16, VALIDATION_ERROR: 3, DUPLICATE_SOURCE_KEY: 3, TARGET_CONFLICT: 1 },
    });
  });

  it('quarantines exactly the manifest records, with the expected stage and code', () => {
    const expected = SEED_ISSUES.filter((i) => i.expectedStage !== null);
    const quarantined = new Map(report.quarantine.map((q) => [q.seq, q]));
    expect([...quarantined.keys()].sort((a, b) => a - b)).toEqual(expected.map((i) => i.seq).sort((a, b) => a - b));
    for (const issue of expected) {
      const q = quarantined.get(issue.seq)!;
      expect(q.stage, `seq ${issue.seq}`).toBe(issue.expectedStage);
      expect(q.errors.map((e) => e.code), `seq ${issue.seq}`).toContain(issue.expectedCode);
    }
  });

  it('contains the prompt-injection record as plain data', () => {
    expect(SEED_SOURCE_RECORDS[41].notes).toMatch(/ignore all previous instructions/i);
  });
});
