import { asc, eq } from 'drizzle-orm';
import { hashOf } from '@/domain/hash';
import type { SourceRecordInput } from '@/domain/types';
import type { DbOrTx } from '../db/client';
import { sourceRecords } from '../db/schema';
import { preexistingEmails } from './target-store';

export function datasetHashOf(records: Record<string, string>[]): string {
  return hashOf(records);
}

export async function loadDataset(tx: DbOrTx, workspaceId: string) {
  const rows = await tx.select().from(sourceRecords).where(eq(sourceRecords.workspaceId, workspaceId)).orderBy(asc(sourceRecords.seq));
  const records: SourceRecordInput[] = rows.map((r) => ({ seq: r.seq, raw: r.raw }));
  return {
    records,
    datasetHash: datasetHashOf(rows.map((r) => r.raw)),
    preexistingEmails: await preexistingEmails(tx, workspaceId),
  };
}
