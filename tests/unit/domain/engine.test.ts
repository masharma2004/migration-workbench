import { describe, expect, it } from 'vitest';
import { dryRun, InvalidPlanError, testTransformation } from '@/domain/engine';
import { MAX_SOURCE_RECORDS } from '@/domain/limits';
import type { SourceRecordInput } from '@/domain/types';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const good = (seq: number, overrides: Record<string, string> = {}): SourceRecordInput => ({
  seq,
  raw: {
    cust_id: `C-${String(seq).padStart(5, '0')}`,
    full_name: 'John Smith',
    email: `john${seq}@example.com`,
    phone: '+44 20 7946 0018',
    signup_date: '2019-03-14',
    status: 'A',
    country: 'USA',
    lifetime_value: '$1,234.50',
    is_vip: 'Y',
    notes: '',
    ...overrides,
  },
});

const run = (records: SourceRecordInput[], preexistingEmails: string[] = []) =>
  dryRun({ records, plan: REFERENCE_PLAN, preexistingEmails });

describe('dryRun', () => {
  it('accepts a clean record and produces the expected target row', () => {
    const r = run([good(1)]);
    expect(r.counts).toMatchObject({ source: 1, transformed: 1, accepted: 1, rejected: 0 });
    expect(r.accepted[0].row).toEqual({
      legacy_id: 'C-00001', first_name: 'John', last_name: 'Smith', email: 'john1@example.com',
      phone_e164: '+442079460018', created_on: '2019-03-14', status: 'active', country_code: 'US',
      lifetime_value_cents: 123450, is_vip: true, marketing_opt_in: false,
    });
    expect(r.accepted[0].rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('collects every field error with source evidence', () => {
    const r = run([good(1, { signup_date: '2019-02-30', lifetime_value: 'N/A', status: 'S' })]);
    expect(r.counts).toMatchObject({ accepted: 0, rejected: 1 });
    const q = r.quarantine[0];
    expect(q.stage).toBe('TRANSFORM_ERROR');
    expect(q.legacyKey).toBe('C-00001');
    expect(q.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetField: 'created_on', sourceField: 'signup_date', sourceValue: '2019-02-30', rule: 'parse_date', code: 'INVALID_DATE' }),
      expect.objectContaining({ targetField: 'lifetime_value_cents', code: 'INVALID_NUMBER' }),
      expect.objectContaining({ targetField: 'status', code: 'UNMAPPED_VALUE', sourceValue: 'S' }),
    ]));
  });

  it('flags target validation failures (bad email format)', () => {
    const r = run([good(1, { email: 'not-an-email' })]);
    expect(r.quarantine[0]).toMatchObject({ stage: 'VALIDATION_ERROR' });
    expect(r.quarantine[0].errors[0]).toMatchObject({ targetField: 'email', code: 'INVALID_FORMAT', sourceValue: 'not-an-email' });
  });

  it('first valid occurrence of a legacy key wins; later ones are DUPLICATE_SOURCE_KEY', () => {
    const r = run([good(1), good(2, { cust_id: 'C-00001', email: 'other@example.com' })]);
    expect(r.counts.accepted).toBe(1);
    expect(r.quarantine[0]).toMatchObject({ seq: 2, stage: 'DUPLICATE_SOURCE_KEY' });
    expect(r.quarantine[0].errors[0].message).toContain('#1');
  });

  it('rejects duplicate emails within the batch, case-insensitively', () => {
    const r = run([good(1), good(2, { email: 'JOHN1@example.com' })]);
    expect(r.quarantine[0]).toMatchObject({ seq: 2, stage: 'VALIDATION_ERROR' });
    expect(r.quarantine[0].errors[0].code).toBe('DUPLICATE_IN_BATCH');
  });

  it('rejects emails that already exist in the target as TARGET_CONFLICT', () => {
    const r = run([good(1)], ['John1@Example.com']);
    expect(r.quarantine[0]).toMatchObject({ stage: 'TARGET_CONFLICT' });
    expect(r.quarantine[0].errors[0].code).toBe('EMAIL_EXISTS_IN_TARGET');
  });

  it('accepts unicode names and plus-addressed emails (review focus 1)', () => {
    const r = run([good(1, { full_name: "José Núñez O'Brien", email: 'a+b@x.io' })]);
    expect(r.accepted[0].row).toMatchObject({ first_name: 'José', last_name: "Núñez O'Brien", email: 'a+b@x.io' });
  });

  it('is deterministic regardless of input order', () => {
    const records = [good(1), good(2, { status: 'S' }), good(3)];
    const a = run(records);
    const b = run([...records].reverse());
    expect(a.reportHash).toBe(b.reportHash);
    expect(a.counts).toEqual(b.counts);
  });

  it('balances counts: source = accepted + rejected, stages sum to rejected', () => {
    const r = run([good(1), good(2, { email: '' }), good(3, { cust_id: 'C-00001', email: 'z@z.io' })]);
    const byStage = Object.values(r.counts.rejectedByStage).reduce((a, b) => a + b, 0);
    expect(r.counts.source).toBe(r.counts.accepted + r.counts.rejected);
    expect(byStage).toBe(r.counts.rejected);
  });

  it('refuses invalid plans and oversize inputs', () => {
    const bad = structuredClone(REFERENCE_PLAN);
    bad.mappings = [];
    expect(() => dryRun({ records: [good(1)], plan: bad, preexistingEmails: [] })).toThrow(InvalidPlanError);
    const many = Array.from({ length: MAX_SOURCE_RECORDS + 1 }, (_, i) => good(i + 1));
    expect(() => run(many)).toThrow(/maximum/);
  });
});

describe('testTransformation', () => {
  it('reports pass/fail counts, codes, failures and samples for one field', () => {
    const records = [good(1), good(2, { signup_date: '31/31/2020' }), good(3, { signup_date: '14-Mar-2019' })];
    const r = testTransformation(records, {
      sourceField: 'signup_date', targetField: 'created_on',
      transforms: [{ rule: 'parse_date', params: { formats: ['YYYY-MM-DD', 'DD-MMM-YYYY'] } }, { rule: 'required', params: {} }],
    });
    if ('issues' in r) throw new Error('unexpected issues');
    expect(r).toMatchObject({ total: 3, passed: 2, failed: 1, failureCodes: { INVALID_DATE: 1 } });
    expect(r.failures[0]).toMatchObject({ seq: 2, sourceValue: '31/31/2020' });
    expect(r.samples[0]).toMatchObject({ seq: 1, output: '2019-03-14' });
  });
  it('also applies target constraints (enum)', () => {
    const r = testTransformation([good(1)], { sourceField: 'status', targetField: 'status', transforms: [] });
    if ('issues' in r) throw new Error('unexpected issues');
    expect(r.failureCodes).toEqual({ INVALID_ENUM: 1 });
  });
  it('returns issues for unknown fields or rules instead of throwing', () => {
    const r = testTransformation([good(1)], { sourceField: 'nope', targetField: 'email', transforms: [{ rule: 'x', params: {} }] });
    expect('issues' in r && r.issues.map((i) => i.code)).toEqual(['UNKNOWN_SOURCE_FIELD', 'UNKNOWN_RULE']);
  });
});
