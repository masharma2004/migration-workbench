import { and, count, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { MAX_SOURCE_RECORDS } from '@/domain/limits';
import { SOURCE_FIELD_DESCRIPTIONS, SOURCE_FIELDS, SOURCE_SCHEMA_VERSION } from '@/domain/schemas/source';
import { TARGET_FIELDS, TARGET_SCHEMA_VERSION } from '@/domain/schemas/target';
import { SEED_PREEXISTING_TARGET, SEED_SOURCE_RECORDS } from '@/seed';
import { db } from '../db/client';
import { migrationRuns, planVersions, sourceRecords, workspaces } from '../db/schema';
import { AppError, notFound } from '../errors';
import { recordEvent } from './audit';
import { datasetHashOf } from './dataset';
import { insertPreexisting } from './target-store';

export async function createWorkspace(records: Record<string, string>[] = SEED_SOURCE_RECORDS): Promise<{ id: string }> {
  if (records.length > MAX_SOURCE_RECORDS) {
    throw new AppError('LIMIT_EXCEEDED', `At most ${MAX_SOURCE_RECORDS} source records are supported (got ${records.length})`);
  }
  const id = nanoid();
  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id, datasetHash: datasetHashOf(records), sourceCount: records.length });
    await tx.insert(sourceRecords).values(records.map((raw, i) => ({
      workspaceId: id, seq: i + 1, legacyKey: raw.cust_id?.trim() || null, raw })));
    await insertPreexisting(tx, id, SEED_PREEXISTING_TARGET);
    await recordEvent(tx, { workspaceId: id, type: 'workspace.created', actor: 'system',
      payload: { sourceCount: records.length, preexistingTargetRows: SEED_PREEXISTING_TARGET.length } });
  });
  return { id };
}

export async function getWorkspace(id: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  if (!ws) throw notFound('Workspace');
  return ws;
}

export async function listSourceRecords(id: string, page: number, pageSize: number) {
  await getWorkspace(id);
  const where = eq(sourceRecords.workspaceId, id);
  const [{ total }] = await db.select({ total: count() }).from(sourceRecords).where(where);
  const rows = await db.select({ seq: sourceRecords.seq, raw: sourceRecords.raw }).from(sourceRecords).where(where)
    .orderBy(sourceRecords.seq).limit(pageSize).offset((page - 1) * pageSize);
  return { total, page, pageSize, rows };
}

export async function getOverview(id: string) {
  const ws = await getWorkspace(id);
  const [approved] = await db.select({ version: planVersions.version }).from(planVersions)
    .where(and(eq(planVersions.workspaceId, id), eq(planVersions.status, 'approved')));
  const [latest] = await db.select({ version: planVersions.version }).from(planVersions)
    .where(eq(planVersions.workspaceId, id)).orderBy(desc(planVersions.version)).limit(1);
  const [lastRun] = await db.select({ status: migrationRuns.status }).from(migrationRuns)
    .where(eq(migrationRuns.workspaceId, id)).orderBy(desc(migrationRuns.startedAt)).limit(1);
  return {
    id: ws.id,
    createdAt: ws.createdAt.toISOString(),
    sourceCount: ws.sourceCount,
    datasetHash: ws.datasetHash,
    maxSourceRecords: MAX_SOURCE_RECORDS,
    approvedVersion: approved?.version ?? null,
    latestVersion: latest?.version ?? null,
    lastRunStatus: lastRun?.status ?? null,
    sourceSchema: { version: SOURCE_SCHEMA_VERSION, fields: SOURCE_FIELDS.map((name) => ({ name, description: SOURCE_FIELD_DESCRIPTIONS[name] })) },
    targetSchema: { version: TARGET_SCHEMA_VERSION, fields: TARGET_FIELDS },
  };
}
export type WorkspaceOverview = Awaited<ReturnType<typeof getOverview>>;
