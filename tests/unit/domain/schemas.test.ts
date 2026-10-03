import { describe, expect, it } from 'vitest';
import { extractField, isSourceField, SOURCE_FIELDS } from '@/domain/schemas/source';
import { getTargetField, TARGET_FIELD_NAMES, TARGET_FIELDS } from '@/domain/schemas/target';

describe('source schema', () => {
  it('has 10 fields including cust_id and notes', () => {
    expect(SOURCE_FIELDS).toHaveLength(10);
    expect(isSourceField('cust_id')).toBe(true);
    expect(isSourceField('nope')).toBe(false);
  });
  it('extractField reads blank and whitespace as null and keeps other text untouched', () => {
    expect(extractField({ email: '' }, 'email')).toBeNull();
    expect(extractField({ email: '   ' }, 'email')).toBeNull();
    expect(extractField({}, 'email')).toBeNull();
    expect(extractField({ email: ' A@B.io ' }, 'email')).toBe(' A@B.io ');
    expect(extractField({ phone: 5550100 }, 'phone')).toBe('5550100');
  });
});

describe('target schema', () => {
  it('defines every field name exactly once, in order', () => {
    expect(TARGET_FIELDS.map((f) => f.name)).toEqual([...TARGET_FIELD_NAMES]);
  });
  it('marks marketing_opt_in as required boolean with no source', () => {
    expect(getTargetField('marketing_opt_in')).toMatchObject({ type: 'boolean', required: true });
  });
  it('returns undefined for unknown fields', () => {
    expect(getTargetField('nope')).toBeUndefined();
  });
});
