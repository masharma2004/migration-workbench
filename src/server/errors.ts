export type ErrorCode =
  | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'NOT_APPROVED' | 'APPROVAL_STALE' | 'ROLLBACK_REQUIRED'
  | 'RUN_IN_PROGRESS' | 'NOTHING_TO_ROLLBACK' | 'NOT_READY' | 'LIMIT_EXCEEDED' | 'RATE_LIMITED'
  | 'LLM_UNAVAILABLE' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, NOT_FOUND: 404, NOT_APPROVED: 409, APPROVAL_STALE: 409, ROLLBACK_REQUIRED: 409,
  RUN_IN_PROGRESS: 409, NOTHING_TO_ROLLBACK: 409, NOT_READY: 409, LIMIT_EXCEEDED: 413, RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 503, INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);
export const conflict = (code: ErrorCode, message: string, details?: unknown) => new AppError(code, message, details);
