import type { TargetRow } from '@/domain/schemas/target';
import type { RejectionStage, SourceRecordInput } from '@/domain/types';
import issues from './issues.json';
import source from './source-customers.json';
import preexisting from './target-preexisting.json';

export interface SeedIssue {
  seq: number;
  issue: string;
  expectedStage: RejectionStage | null;
  expectedCode: string | null;
  note: string;
}

export const SEED_SOURCE_RECORDS: Record<string, string>[] = source;
export const SEED_PREEXISTING_TARGET: TargetRow[] = preexisting as TargetRow[];
export const SEED_ISSUES: SeedIssue[] = issues as SeedIssue[];

export function seedRecordsAsInput(): SourceRecordInput[] {
  return SEED_SOURCE_RECORDS.map((raw, i) => ({ seq: i + 1, raw }));
}
