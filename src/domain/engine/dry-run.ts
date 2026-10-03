import { hashOf } from '../hash';
import { MAX_SOURCE_RECORDS } from '../limits';
import { planHash, type Plan } from '../plan';
import { extractField } from '../schemas/source';
import { TARGET_FIELD_NAMES, type TargetRow } from '../schemas/target';
import { LimitExceededError, REJECTION_STAGES, type FieldError, type RejectionStage, type SourceRecordInput } from '../types';
import { compilePlan } from './compile';
import { transformRecord } from './transform';
import { validateTargetRow } from './validate-target';

export interface AcceptedRow { seq: number; legacyId: string; row: TargetRow; rowHash: string }
export interface QuarantineEntry {
  seq: number;
  legacyKey: string | null;
  stage: RejectionStage;
  errors: FieldError[];
  raw: Record<string, unknown>;
}
export interface DryRunCounts {
  source: number;
  transformed: number;
  accepted: number;
  rejected: number;
  rejectedByStage: Record<RejectionStage, number>;
}
export interface DryRunReport {
  planHash: string;
  counts: DryRunCounts;
  accepted: AcceptedRow[];
  quarantine: QuarantineEntry[];
  reportHash: string;
}

export function rowHash(row: TargetRow): string {
  return hashOf(TARGET_FIELD_NAMES.map((f) => [f, row[f] ?? null]));
}

export function dryRun(input: {
  records: SourceRecordInput[];
  plan: Plan;
  preexistingEmails: readonly string[];
}): DryRunReport {
  if (input.records.length > MAX_SOURCE_RECORDS) {
    throw new LimitExceededError(`Dataset has ${input.records.length} records; the maximum is ${MAX_SOURCE_RECORDS}`);
  }
  const mappings = compilePlan(input.plan);
  const legacySource = mappings.find((m) => m.targetField === 'legacy_id')?.sourceField ?? null;
  const emailSource = mappings.find((m) => m.targetField === 'email')?.sourceField ?? null;
  const preexisting = new Set(input.preexistingEmails.map((e) => e.toLowerCase()));
  const seenLegacy = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const accepted: AcceptedRow[] = [];
  const quarantine: QuarantineEntry[] = [];
  let transformed = 0;

  const records = [...input.records].sort((a, b) => a.seq - b.seq);
  for (const rec of records) {
    const legacyKey = extractField(rec.raw, 'cust_id');
    const reject = (stage: RejectionStage, errors: FieldError[]) =>
      quarantine.push({ seq: rec.seq, legacyKey, stage, errors, raw: rec.raw });

    const { row, errors } = transformRecord(rec.raw, mappings);
    if (errors.length) { reject('TRANSFORM_ERROR', errors); continue; }
    transformed += 1;

    const full = row as TargetRow;
    const invalid = validateTargetRow(full, rec.raw, mappings);
    if (invalid.length) { reject('VALIDATION_ERROR', invalid); continue; }

    // Keys are claimed by the first record that passes transformation and validation.
    const legacyId = String(full.legacy_id);
    const firstLegacy = seenLegacy.get(legacyId);
    if (firstLegacy !== undefined) {
      reject('DUPLICATE_SOURCE_KEY', [{ targetField: 'legacy_id', sourceField: legacySource,
        sourceValue: legacySource ? extractField(rec.raw, legacySource) : null, rule: null,
        code: 'DUPLICATE_SOURCE_KEY', message: `legacy_id "${legacyId}" already used by record #${firstLegacy}` }]);
      continue;
    }
    seenLegacy.set(legacyId, rec.seq);

    const emailKey = String(full.email).toLowerCase();
    const emailEvidence = { targetField: 'email', sourceField: emailSource,
      sourceValue: emailSource ? extractField(rec.raw, emailSource) : null, rule: null };
    const firstEmail = seenEmail.get(emailKey);
    if (firstEmail !== undefined) {
      reject('VALIDATION_ERROR', [{ ...emailEvidence, code: 'DUPLICATE_IN_BATCH',
        message: `email "${emailKey}" already used by record #${firstEmail}` }]);
      continue;
    }
    seenEmail.set(emailKey, rec.seq);

    if (preexisting.has(emailKey)) {
      reject('TARGET_CONFLICT', [{ ...emailEvidence, code: 'EMAIL_EXISTS_IN_TARGET',
        message: `email "${emailKey}" already belongs to an existing target customer` }]);
      continue;
    }
    accepted.push({ seq: rec.seq, legacyId, row: full, rowHash: rowHash(full) });
  }

  const rejectedByStage = Object.fromEntries(REJECTION_STAGES.map((s) => [s, 0])) as Record<RejectionStage, number>;
  for (const q of quarantine) rejectedByStage[q.stage] += 1;
  const counts: DryRunCounts = {
    source: records.length, transformed, accepted: accepted.length, rejected: quarantine.length, rejectedByStage,
  };
  const pHash = planHash(input.plan);
  const reportHash = hashOf({
    planHash: pHash,
    counts,
    accepted: accepted.map((a) => [a.seq, a.rowHash]),
    quarantine: quarantine.map((q) => [q.seq, q.stage, q.errors]),
  });
  return { planHash: pHash, counts, accepted, quarantine, reportHash };
}
