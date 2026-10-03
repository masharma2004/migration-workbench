import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { listEvents } from '@/server/services/audit';
import { csvCell, getDryRun, listQuarantine, quarantineCsv, runDryRun } from '@/server/services/dry-runs';
import { createVersion, diffVersions, getVersion, listVersions } from '@/server/services/plans';
import { REFERENCE_PLAN } from '@/seed/reference-plan';
import { createTestWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

const content = (plan = REFERENCE_PLAN) => ({ plan, risks: [], incompatibilities: [], questions: [], summary: 's' });

describe('plan versions', () => {
  it('numbers versions sequentially, keeps them immutable and records audit events', async () => {
    const ws = await createTestWorkspace();
    const v1 = await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 'tester' });
    const edited = structuredClone(REFERENCE_PLAN);
    edited.mappings.find((m) => m.targetField === 'phone_e164')!.transforms[1].params = { defaultCountry: 'GB' };
    const v2 = await createVersion(db, { workspaceId: ws, content: content(edited), author: 'user',
      parentVersionId: v1.id, changeNote: 'GB default', actor: 'tester' });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v2.parentVersionId).toBe(v1.id);
    expect(v1.planHash).not.toBe(v2.planHash);
    expect((await getVersion(ws, 1)).planHash).toBe(v1.planHash);
    expect((await listVersions(ws)).map((v) => v.version)).toEqual([2, 1]);
    const diff = await diffVersions(ws, 1, 2);
    expect(diff.changed.map((c) => c.targetField)).toEqual(['phone_e164']);
    expect((await listEvents(ws)).filter((e) => e.type === 'plan.version_created')).toHaveLength(2);
  });

  it('stores drafts with validation issues but rejects malformed content', async () => {
    const ws = await createTestWorkspace();
    const broken = structuredClone(REFERENCE_PLAN);
    broken.mappings.pop();
    const v = await createVersion(db, { workspaceId: ws, content: content(broken), author: 'user', actor: 't' });
    expect(v.issues.map((i) => i.code)).toContain('MISSING_TARGET_MAPPING');
    await expect(createVersion(db, { workspaceId: ws, content: { plan: { nope: 1 } }, author: 'user', actor: 't' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('csvCell (review #10)', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('plain')).toBe('"plain"');
  });
});

describe('dry runs', () => {
  it('persists counts and quarantine with field-level evidence, deterministically', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 't' });
    const a = await runDryRun(ws, 1, 'tester');
    const b = await runDryRun(ws, 1, 'tester');
    expect(a.counts).toMatchObject({ source: 200, accepted: 177, rejected: 23 });
    expect(a.reportHash).toBe(b.reportHash);
    expect((await getDryRun(ws, a.id)).reportHash).toBe(a.reportHash);
    const q = await listQuarantine(ws, a.id, {});
    expect(q).toHaveLength(23);
    const dates = await listQuarantine(ws, a.id, { code: 'INVALID_DATE' });
    expect(dates.map((x) => x.seq)).toEqual([12, 48, 150]);
    expect(dates[0].errors[0]).toMatchObject({ sourceField: 'signup_date', sourceValue: '2019-02-30' });
    const csv = await quarantineCsv(ws, a.id);
    expect(csv.split('\n')[0]).toBe('seq,legacy_key,stage,target_field,source_field,source_value,rule,code,message');
    expect(csv).toContain('"2019-02-30"');
  });

  it('refuses to dry-run an invalid plan with NOT_READY', async () => {
    const ws = await createTestWorkspace();
    const broken = structuredClone(REFERENCE_PLAN);
    broken.mappings.pop();
    await createVersion(db, { workspaceId: ws, content: content(broken), author: 'user', actor: 't' });
    await expect(runDryRun(ws, 1, 't')).rejects.toMatchObject({ code: 'NOT_READY' });
  });
});
