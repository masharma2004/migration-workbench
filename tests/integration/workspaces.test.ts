import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { listEvents } from '@/server/services/audit';
import { loadDataset } from '@/server/services/dataset';
import { listTargetRows } from '@/server/services/target-store';
import { createWorkspace, getOverview, getWorkspace, listSourceRecords } from '@/server/services/workspaces';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('workspaces', () => {
  it('creates an isolated workspace seeded with 200 source records and 8 pre-existing target rows', async () => {
    const { id } = await createWorkspace();
    expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    const ws = await getWorkspace(id);
    expect(ws.sourceCount).toBe(200);
    const target = await listTargetRows(id, 1, 50);
    expect(target.total).toBe(8);
    expect(target.rows.every((r) => r.origin === 'preexisting')).toBe(true);
    const events = await listEvents(id);
    expect(events.map((e) => e.type)).toEqual(['workspace.created']);
  });

  it('keeps workspaces isolated', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    expect((await listTargetRows(a.id, 1, 50)).total).toBe(8);
    expect((await listTargetRows(b.id, 1, 50)).total).toBe(8);
  });

  it('loads the dataset with a stable hash and pre-existing emails', async () => {
    const { id } = await createWorkspace();
    const d1 = await loadDataset(db, id);
    const d2 = await loadDataset(db, id);
    expect(d1.records).toHaveLength(200);
    expect(d1.records[0].seq).toBe(1);
    expect(d1.datasetHash).toBe(d2.datasetHash);
    expect(d1.preexistingEmails).toHaveLength(8);
  });

  it('pages source records and builds an overview', async () => {
    const { id } = await createWorkspace();
    const page = await listSourceRecords(id, 2, 25);
    expect(page).toMatchObject({ total: 200, page: 2, pageSize: 25 });
    expect(page.rows[0].seq).toBe(26);
    const overview = await getOverview(id);
    expect(overview).toMatchObject({ id, sourceCount: 200, maxSourceRecords: 500, approvedVersion: null, latestVersion: null });
  });

  it('throws NOT_FOUND for unknown workspaces', async () => {
    await expect(getWorkspace('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
