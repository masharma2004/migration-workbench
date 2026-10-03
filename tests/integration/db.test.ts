import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { auditEvents, workspaces } from '@/server/db/schema';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('database', () => {
  it('has the app and target schemas', async () => {
    const rows = await db.execute<{ schema_name: string }>(
      sql`select schema_name from information_schema.schemata where schema_name in ('app','target') order by 1`);
    expect(rows.map((r) => r.schema_name)).toEqual(['app', 'target']);
  });

  it('rejects UPDATE and DELETE on audit_events', async () => {
    await db.insert(workspaces).values({ id: 'ws-audit', datasetHash: 'h', sourceCount: 0 });
    const [ev] = await db.insert(auditEvents).values({ workspaceId: 'ws-audit', type: 't', actor: 'test' }).returning();
    await expect(db.execute(sql`update app.audit_events set type = 'x' where id = ${ev.id}`)).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }) });
    await expect(db.execute(sql`delete from app.audit_events where id = ${ev.id}`)).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }) });
  });
});
