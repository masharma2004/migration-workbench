export type Scalar = string | number | boolean | null;

export type RuleResult = { ok: true; value: Scalar } | { ok: false; code: string; message: string };

export interface FieldError {
  targetField: string;
  sourceField: string | null;
  sourceValue: string | null;
  rule: string | null;
  code: string;
  message: string;
}

export type RejectionStage =
  | 'TRANSFORM_ERROR'
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_SOURCE_KEY'
  | 'TARGET_CONFLICT';

export const REJECTION_STAGES: readonly RejectionStage[] = [
  'TRANSFORM_ERROR',
  'VALIDATION_ERROR',
  'DUPLICATE_SOURCE_KEY',
  'TARGET_CONFLICT',
];

export interface SourceRecordInput {
  seq: number;
  raw: Record<string, unknown>;
}

export class LimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LimitExceededError';
  }
}
