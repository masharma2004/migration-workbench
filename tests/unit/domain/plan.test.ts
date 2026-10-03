import { describe, expect, it } from 'vitest';
import { diffPlans, planHash, planSchema, validatePlan, versionContentSchema, type Plan } from '@/domain/plan';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const clone = (): Plan => structuredClone(REFERENCE_PLAN);
const codes = (plan: Plan) => validatePlan(plan).map((i) => i.code);

describe('reference plan', () => {
  it('parses and validates with no issues', () => {
    expect(planSchema.parse(REFERENCE_PLAN)).toBeTruthy();
    expect(validatePlan(REFERENCE_PLAN)).toEqual([]);
  });
});

describe('validatePlan', () => {
  it('flags unknown target, source, rule and bad params', () => {
    const p = clone();
    p.mappings[0].targetField = 'nope';
    p.mappings[1].sourceField = 'nope';
    p.mappings[2].transforms.push({ rule: 'uppercase', params: {} });
    p.mappings[5].transforms[1] = { rule: 'parse_date', params: { formats: [] } };
    const c = codes(p);
    expect(c).toContain('UNKNOWN_TARGET_FIELD');
    expect(c).toContain('UNKNOWN_SOURCE_FIELD');
    expect(c).toContain('UNKNOWN_RULE');
    expect(c).toContain('INVALID_PARAMS');
    expect(c).toContain('MISSING_TARGET_MAPPING'); // legacy_id lost its mapping
  });
  it('flags duplicate target mappings', () => {
    const p = clone();
    p.mappings.push(structuredClone(p.mappings[3]));
    expect(codes(p)).toContain('DUPLICATE_TARGET_MAPPING');
  });
  it('requires required/default_value on required targets and default_value on constants', () => {
    const p = clone();
    const email = p.mappings.find((m) => m.targetField === 'email')!;
    email.transforms = email.transforms.filter((t) => t.rule !== 'required');
    const opt = p.mappings.find((m) => m.targetField === 'marketing_opt_in')!;
    opt.transforms = [];
    expect(codes(p)).toEqual(
      expect.arrayContaining(['REQUIRED_NOT_ENFORCED', 'CONSTANT_WITHOUT_DEFAULT']),
    );
  });
  it('requires every source field to be mapped or dropped, not both', () => {
    const p = clone();
    p.unmappedSourceFields = [];
    expect(codes(p)).toContain('SOURCE_FIELD_UNACCOUNTED');
    const q = clone();
    q.unmappedSourceFields.push({ field: 'email', decision: 'drop', reason: 'x' });
    expect(codes(q)).toContain('SOURCE_FIELD_BOTH');
  });
  it('flags schema version mismatch', () => {
    const p = clone();
    p.targetSchemaVersion = 'target-v0';
    expect(codes(p)).toContain('SCHEMA_VERSION_MISMATCH');
  });
});

describe('planHash', () => {
  it('ignores mapping order, rationale and confidence', () => {
    const p = clone();
    p.mappings.reverse();
    p.mappings[0].rationale = 'changed';
    p.mappings[0].confidence = 'low';
    expect(planHash(p)).toBe(planHash(REFERENCE_PLAN));
  });
  it('treats explicit default params the same as omitted ones', () => {
    const p = clone();
    const status = p.mappings.find((m) => m.targetField === 'status')!;
    const mv = status.transforms.find((t) => t.rule === 'map_values')!;
    delete (mv.params as Record<string, unknown>).caseInsensitive;
    expect(planHash(p)).toBe(planHash(REFERENCE_PLAN));
  });
  it('changes when a transform param changes', () => {
    const p = clone();
    p.mappings.find((m) => m.targetField === 'phone_e164')!.transforms[1].params = { defaultCountry: 'GB' };
    expect(planHash(p)).not.toBe(planHash(REFERENCE_PLAN));
  });
});

describe('diffPlans', () => {
  it('reports identical plans', () => {
    expect(diffPlans(REFERENCE_PLAN, clone()).identical).toBe(true);
  });
  it('reports changed, removed and unmapped changes', () => {
    const p = clone();
    p.mappings.find((m) => m.targetField === 'phone_e164')!.transforms[1].params = { defaultCountry: 'GB' };
    p.mappings = p.mappings.filter((m) => m.targetField !== 'country_code');
    p.unmappedSourceFields.push({ field: 'country', decision: 'drop', reason: 'not needed' });
    const d = diffPlans(REFERENCE_PLAN, p);
    expect(d.changed.map((c) => c.targetField)).toEqual(['phone_e164']);
    expect(d.removed).toEqual(['country_code']);
    expect(d.unmappedAdded).toEqual(['country']);
    expect(d.identical).toBe(false);
  });
});

describe('size bounds (review #4)', () => {
  it('rejects absurd numbers of mappings or transforms', () => {
    const many = { ...REFERENCE_PLAN, mappings: Array.from({ length: 51 }, () => REFERENCE_PLAN.mappings[0]) };
    expect(planSchema.safeParse(many).success).toBe(false);
    const long = structuredClone(REFERENCE_PLAN);
    long.mappings[0].transforms = Array.from({ length: 11 }, () => ({ rule: 'trim', params: {} }));
    expect(planSchema.safeParse(long).success).toBe(false);
  });
});

describe('versionContentSchema', () => {
  it('applies defaults for metadata arrays', () => {
    const c = versionContentSchema.parse({ plan: REFERENCE_PLAN });
    expect(c).toMatchObject({ risks: [], incompatibilities: [], questions: [], summary: '' });
  });
});
