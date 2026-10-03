import { and, count, eq, inArray } from 'drizzle-orm';
import type { AcceptedRow } from '@/domain/engine';
import { rowHash } from '@/domain/engine';
import type { TargetRow } from '@/domain/schemas/target';
import { db, type DbOrTx } from '../db/client';
import { targetCustomers } from '../db/schema';

type DbRow = typeof targetCustomers.$inferSelect;

/** DB row → canonical TargetRow (same representation the engine hashes). */
export function dbRowToTarget(r: DbRow): TargetRow {
  return {
    legacy_id: r.legacyId, first_name: r.firstName, last_name: r.lastName, email: r.email, phone_e164: r.phoneE164,
    created_on: r.createdOn, status: r.status, country_code: r.countryCode, lifetime_value_cents: Number(r.lifetimeValueCents),
    is_vip: r.isVip, marketing_opt_in: r.marketingOptIn,
  };
}

function targetToDbValues(row: TargetRow, meta: { workspaceId: string; origin: 'preexisting' | 'migrated'; runId: string | null }) {
  return {
    legacyId: row.legacy_id as string | null, firstName: String(row.first_name), lastName: row.last_name as string | null,
    email: String(row.email), phoneE164: row.phone_e164 as string | null, createdOn: String(row.created_on),
    status: String(row.status), countryCode: row.country_code as string | null,
    lifetimeValueCents: Number(row.lifetime_value_cents), isVip: Boolean(row.is_vip), marketingOptIn: Boolean(row.marketing_opt_in),
    workspaceId: meta.workspaceId, origin: meta.origin, runId: meta.runId, rowHash: rowHash(row),
  };
}

export async function insertPreexisting(tx: DbOrTx, workspaceId: string, rows: TargetRow[]): Promise<void> {
  if (!rows.length) return;
  await tx.insert(targetCustomers).values(rows.map((r) => targetToDbValues(r, { workspaceId, origin: 'preexisting', runId: null })));
}

export async function listTargetRows(workspaceId: string, page: number, pageSize: number) {
  const where = eq(targetCustomers.workspaceId, workspaceId);
  const [{ total }] = await db.select({ total: count() }).from(targetCustomers).where(where);
  const rows = await db.select().from(targetCustomers).where(where)
    .orderBy(targetCustomers.origin, targetCustomers.legacyId).limit(pageSize).offset((page - 1) * pageSize);
  return {
    total, page, pageSize,
    rows: rows.map((r) => ({ ...dbRowToTarget(r), origin: r.origin, runId: r.runId, rowHash: r.rowHash })),
  };
}

export async function migratedRows(tx: DbOrTx, workspaceId: string, runIds: string[]) {
  if (!runIds.length) return [];
  const rows = await tx.select().from(targetCustomers).where(and(eq(targetCustomers.workspaceId, workspaceId),
    eq(targetCustomers.origin, 'migrated'), inArray(targetCustomers.runId, runIds)));
  return rows.map((r) => ({ legacyId: String(r.legacyId), row: dbRowToTarget(r), storedHash: r.rowHash }));
}

/** All migrated rows in the workspace regardless of run (used to detect orphans). */
export async function allMigratedRows(tx: DbOrTx, workspaceId: string) {
  const rows = await tx.select().from(targetCustomers)
    .where(and(eq(targetCustomers.workspaceId, workspaceId), eq(targetCustomers.origin, 'migrated')));
  return rows.map((r) => ({ legacyId: String(r.legacyId), row: dbRowToTarget(r), runId: r.runId }));
}

export async function preexistingRows(tx: DbOrTx, workspaceId: string): Promise<TargetRow[]> {
  const rows = await tx.select().from(targetCustomers)
    .where(and(eq(targetCustomers.workspaceId, workspaceId), eq(targetCustomers.origin, 'preexisting')));
  return rows.map(dbRowToTarget);
}

export async function preexistingEmails(tx: DbOrTx, workspaceId: string): Promise<string[]> {
  const rows = await tx.select({ email: targetCustomers.email }).from(targetCustomers)
    .where(and(eq(targetCustomers.workspaceId, workspaceId), eq(targetCustomers.origin, 'preexisting')));
  return rows.map((r) => r.email).sort();
}

/** Insert-only; existing (workspace, legacy_id) rows are left untouched. Returns legacy ids actually inserted. */
export async function insertMigratedBatch(tx: DbOrTx, workspaceId: string, runId: string, rows: AcceptedRow[]): Promise<string[]> {
  if (!rows.length) return [];
  const inserted = await tx.insert(targetCustomers)
    .values(rows.map((a) => targetToDbValues(a.row, { workspaceId, origin: 'migrated', runId })))
    .onConflictDoNothing({ target: [targetCustomers.workspaceId, targetCustomers.legacyId] })
    .returning({ legacyId: targetCustomers.legacyId });
  return inserted.map((r) => String(r.legacyId));
}

export async function storedHashes(tx: DbOrTx, workspaceId: string, legacyIds: string[]): Promise<Map<string, string>> {
  if (!legacyIds.length) return new Map();
  const rows = await tx.select({ legacyId: targetCustomers.legacyId, rowHash: targetCustomers.rowHash }).from(targetCustomers)
    .where(and(eq(targetCustomers.workspaceId, workspaceId), inArray(targetCustomers.legacyId, legacyIds)));
  return new Map(rows.map((r) => [String(r.legacyId), r.rowHash]));
}

export async function deleteMigrated(tx: DbOrTx, workspaceId: string, runIds: string[]): Promise<number> {
  if (!runIds.length) return 0;
  const deleted = await tx.delete(targetCustomers).where(and(eq(targetCustomers.workspaceId, workspaceId),
    eq(targetCustomers.origin, 'migrated'), inArray(targetCustomers.runId, runIds))).returning({ id: targetCustomers.id });
  return deleted.length;
}

