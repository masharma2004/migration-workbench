import { describe, expect, it } from 'vitest';
import { dryRun } from '@/domain/engine';
import { reconcile } from '@/domain/reconcile';
import type { TargetRow } from '@/domain/schemas/target';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const rec = (seq: number, extra: Record<string, string> = {}) => ({
  seq,
  raw: { cust_id: `C-${seq}`, full_name: 'Ann Lee', email: `ann${seq}@x.io`, phone: '', signup_date: '2020-01-0' + seq,
    status: 'A', country: 'IN', lifetime_value: '10.00', is_vip: 'N', notes: '', ...extra },
});
const report = dryRun({ records: [rec(1), rec(2), rec(3, { status: 'S' })], plan: REFERENCE_PLAN, preexistingEmails: [] });
const pre: TargetRow = { legacy_id: null, first_name: 'Pre', last_name: 'Existing', email: 'pre@x.io', phone_e164: null,
  created_on: '2024-01-01', status: 'active', country_code: 'US', lifetime_value_cents: 0, is_vip: false, marketing_opt_in: true };
const migratedFrom = (r = report) => r.accepted.map((a) => ({ legacyId: a.legacyId, row: structuredClone(a.row) }));
const base = () => ({ sourceCount: 3, report, migrated: migratedFrom(), preexistingExpected: [pre], preexistingActual: [structuredClone(pre)] });

describe('reconcile', () => {
  it('passes when target matches the expected accepted set', () => {
    const r = reconcile(base());
    expect(r.result).toBe('pass');
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(['source_balance', 'row_count', 'control_total', 'per_record', 'preexisting_untouched']);
  });
  it('detects a missing row (partial run)', () => {
    const input = base();
    input.migrated.pop();
    const r = reconcile(input);
    expect(r.result).toBe('fail');
    expect(r.missing).toEqual(['C-2']);
  });
  it('detects tampering via recomputed row hashes and control totals', () => {
    const input = base();
    input.migrated[0].row.lifetime_value_cents = 999;
    const r = reconcile(input);
    expect(r.mismatched.map((m) => m.legacyId)).toEqual(['C-1']);
    expect(r.checks.find((c) => c.id === 'control_total')!.passed).toBe(false);
  });
  it('detects unexpected rows and modified pre-existing rows', () => {
    const input = base();
    input.migrated.push({ legacyId: 'C-99', row: { ...input.migrated[0].row, legacy_id: 'C-99' } });
    input.preexistingActual[0].status = 'closed';
    const r = reconcile(input);
    expect(r.unexpected).toEqual(['C-99']);
    expect(r.checks.find((c) => c.id === 'preexisting_untouched')!.passed).toBe(false);
  });
  it('with no active migration, passes only when no migrated rows remain', () => {
    const clean = reconcile({ ...base(), report: null, migrated: [] });
    expect(clean).toMatchObject({ result: 'pass', activeMigration: false });
    const dirty = reconcile({ ...base(), report: null });
    expect(dirty.result).toBe('fail');
  });
});
