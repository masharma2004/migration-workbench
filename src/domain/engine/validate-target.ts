import { extractField } from '../schemas/source';
import { TARGET_FIELDS, type TargetFieldDef, type TargetRow } from '../schemas/target';
import type { FieldError, Scalar } from '../types';
import type { CompiledMapping } from './compile';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const ISO2_RE = /^[A-Z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTargetValue(def: TargetFieldDef, value: Scalar): { code: string; message: string } | null {
  if (value === null) {
    return def.required ? { code: 'REQUIRED', message: `${def.name} is required` } : null;
  }
  switch (def.type) {
    case 'string':
    case 'enum':
      if (typeof value !== 'string') return { code: 'TYPE_MISMATCH', message: `${def.name} must be text` };
      break;
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value)) return { code: 'TYPE_MISMATCH', message: `${def.name} must be YYYY-MM-DD` };
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return { code: 'TYPE_MISMATCH', message: `${def.name} must be a whole number` };
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return { code: 'TYPE_MISMATCH', message: `${def.name} must be true or false` };
      break;
  }
  if (typeof value === 'string') {
    if (def.maxLength && value.length > def.maxLength) return { code: 'MAX_LENGTH', message: `${def.name} exceeds ${def.maxLength} characters` };
    if (def.enumValues && !def.enumValues.includes(value)) return { code: 'INVALID_ENUM', message: `${def.name} must be one of ${def.enumValues.join(', ')}` };
    const re = def.format === 'email' ? EMAIL_RE : def.format === 'e164' ? E164_RE : def.format === 'iso2' ? ISO2_RE : null;
    if (re && !re.test(value)) return { code: 'INVALID_FORMAT', message: `${def.name} is not a valid ${def.format}` };
  }
  if (typeof value === 'number') {
    if (def.min !== undefined && value < def.min) return { code: 'BELOW_MIN', message: `${def.name} must be >= ${def.min}` };
    if (def.max !== undefined && value > def.max) return { code: 'ABOVE_MAX', message: `${def.name} must be <= ${def.max}` };
  }
  return null;
}

export function validateTargetRow(row: TargetRow, raw: Record<string, unknown>, mappings: CompiledMapping[]): FieldError[] {
  const sourceOf = new Map(mappings.map((m) => [m.targetField, m.sourceField]));
  const errors: FieldError[] = [];
  for (const def of TARGET_FIELDS) {
    const problem = validateTargetValue(def, row[def.name] ?? null);
    if (problem) {
      const sourceField = sourceOf.get(def.name) ?? null;
      errors.push({ targetField: def.name, sourceField, sourceValue: sourceField ? extractField(raw, sourceField) : null,
        rule: null, ...problem });
    }
  }
  return errors;
}
