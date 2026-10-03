import { describe, expect, it } from 'vitest';
import { checkEvidence, coerceParams, draftToContent } from '@/server/agent/draft';
import { ALLOWED_TOOLS, runTool, TOOL_DECLS, ToolArgError } from '@/server/agent/tools';
import { seedRecordsAsInput } from '@/seed';
import { REFERENCE_DRAFT } from '@/seed/reference-draft';

const ctx = { records: seedRecordsAsInput() };

describe('tool registry', () => {
  it('declares exactly the 8 allowed tools with object JSON schemas', () => {
    expect(TOOL_DECLS.map((t) => t.name)).toEqual([...ALLOWED_TOOLS]);
    for (const t of TOOL_DECLS) expect(t.parameters).toMatchObject({ type: 'object' });
  });
  it('profiles a field and flags ambiguous dates', () => {
    const r = runTool('profile_field', { field: 'signup_date' }, ctx) as { patterns: { pattern: string }[] };
    expect(r.patterns.some((p) => p.pattern.includes('ambiguous'))).toBe(true);
  });
  it('wraps sample records as untrusted data and caps the limit at 20', () => {
    const r = runTool('get_sample_records', { limit: 50, offset: 40 }, ctx) as { untrusted: boolean; records: { seq: number; notes: string }[] };
    expect(r.untrusted).toBe(true);
    expect(r.records).toHaveLength(20);
    expect(r.records.find((x) => x.seq === 42)?.notes).toMatch(/ignore all previous instructions/i);
  });
  it('rejects bad args with ToolArgError', () => {
    expect(() => runTool('profile_field', { field: 7 }, ctx)).toThrow(ToolArgError);
    expect(() => runTool('profile_field', { field: 'nope' }, ctx)).toThrow(/Unknown source field/);
  });
  it('validate_plan accepts the flattened draft shape', () => {
    expect(runTool('validate_plan', { mappings: REFERENCE_DRAFT.mappings, unmappedSourceFields: REFERENCE_DRAFT.unmappedSourceFields }, ctx))
      .toEqual({ valid: true, issues: [] });
  });
});

describe('draft handling (review focus 4)', () => {
  it('converts the reference draft into valid version content', () => {
    const { content, issues } = draftToContent(REFERENCE_DRAFT);
    expect(issues).toEqual([]);
    expect(content?.plan.mappings.find((m) => m.targetField === 'marketing_opt_in')?.sourceField).toBeNull();
  });
  it('accepts params given as a JSON string', () => {
    expect(coerceParams('{"part":"first"}')).toEqual({ part: 'first' });
    expect(coerceParams('not json')).toBe('not json');
  });
  it('reports malformed drafts as issues instead of throwing', () => {
    expect(draftToContent({ mappings: 'oops' }).issues[0].code).toBe('MALFORMED_DRAFT');
    const missing = structuredClone(REFERENCE_DRAFT);
    missing.mappings = missing.mappings.slice(1);
    expect(draftToContent(missing).issues.map((i) => i.code)).toContain('MISSING_TARGET_MAPPING');
  });
  it('requires risks to cite evidence from executed tool steps', () => {
    const { content } = draftToContent(REFERENCE_DRAFT);
    expect(checkEvidence(content!, new Set([2, 4, 5, 6]))).toEqual([]);
    expect(checkEvidence(content!, new Set([2, 4])).map((i) => i.code)).toEqual(['EVIDENCE_NOT_FOUND', 'EVIDENCE_NOT_FOUND']);
  });
});
