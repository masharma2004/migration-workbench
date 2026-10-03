import { rowHash, type DryRunReport } from './engine';
import type { TargetRow } from './schemas/target';

export type ReconcileCheckId = 'source_balance' | 'row_count' | 'control_total' | 'per_record' | 'preexisting_untouched';

export interface ReconcileCheck {
  id: ReconcileCheckId;
  label: string;
  passed: boolean;
  expected: string | number;
  actual: string | number;
  detail?: string;
}

export interface ReconcileInput {
  sourceCount: number;
  report: DryRunReport | null;
  migrated: { legacyId: string; row: TargetRow }[];
  preexistingExpected: TargetRow[];
  preexistingActual: TargetRow[];
}

export interface ReconcileResult {
  result: 'pass' | 'fail';
  activeMigration: boolean;
  checks: ReconcileCheck[];
  missing: string[];
  unexpected: string[];
  mismatched: { legacyId: string; expectedHash: string; actualHash: string }[];
}

const cents = (row: TargetRow) => (typeof row.lifetime_value_cents === 'number' ? row.lifetime_value_cents : 0);

export function reconcile(input: ReconcileInput): ReconcileResult {
  const expected = new Map((input.report?.accepted ?? []).map((a) => [a.legacyId, a.rowHash]));
  const actual = new Map(input.migrated.map((m) => [m.legacyId, rowHash(m.row)]));

  const missing = [...expected.keys()].filter((k) => !actual.has(k)).sort();
  const unexpected = [...actual.keys()].filter((k) => !expected.has(k)).sort();
  const mismatched = [...expected.entries()]
    .filter(([k, h]) => actual.has(k) && actual.get(k) !== h)
    .map(([legacyId, expectedHash]) => ({ legacyId, expectedHash, actualHash: actual.get(legacyId)! }))
    .sort((a, b) => a.legacyId.localeCompare(b.legacyId));

  const counts = input.report?.counts;
  const expectedTotal = (input.report?.accepted ?? []).reduce((s, a) => s + cents(a.row), 0);
  const actualTotal = input.migrated.reduce((s, m) => s + cents(m.row), 0);
  const preHash = (rows: TargetRow[]) => rows.map(rowHash).sort().join(',');

  const checks: ReconcileCheck[] = [
    counts
      ? { id: 'source_balance', label: 'Source = accepted + rejected',
          passed: counts.source === input.sourceCount && counts.accepted + counts.rejected === counts.source,
          expected: input.sourceCount, actual: `${counts.accepted} + ${counts.rejected}` }
      : { id: 'source_balance', label: 'Source = accepted + rejected', passed: true, expected: 'n/a', actual: 'n/a',
          detail: 'No active migration' },
    { id: 'row_count', label: 'Accepted rows = migrated rows in target', passed: expected.size === actual.size,
      expected: expected.size, actual: actual.size },
    { id: 'control_total', label: 'Σ lifetime_value_cents matches', passed: expectedTotal === actualTotal,
      expected: expectedTotal, actual: actualTotal },
    { id: 'per_record', label: 'Every row present with identical content',
      passed: !missing.length && !unexpected.length && !mismatched.length, expected: 0,
      actual: missing.length + unexpected.length + mismatched.length,
      detail: `${missing.length} missing, ${unexpected.length} unexpected, ${mismatched.length} mismatched` },
    { id: 'preexisting_untouched', label: 'Pre-existing target rows unchanged',
      passed: preHash(input.preexistingExpected) === preHash(input.preexistingActual),
      expected: input.preexistingExpected.length, actual: input.preexistingActual.length },
  ];

  return {
    result: checks.every((c) => c.passed) ? 'pass' : 'fail',
    activeMigration: input.report !== null,
    checks, missing, unexpected, mismatched,
  };
}
