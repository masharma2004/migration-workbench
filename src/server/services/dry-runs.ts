import { and, asc, desc, eq } from 'drizzle-orm';
import { dryRun, InvalidPlanError, type DryRunCounts, type DryRunReport } from '@/domain/engine';
import type { FieldError } from '@/domain/types';
import { db, type DbOrTx } from '../db/client';
import { dryRuns, quarantineRecords } from '../db/schema';
import { AppError, notFound } from '../errors';
import { recordEvent } from './audit';
import { loadDataset } from './dataset';
import { getVersion, type PlanVersionDto } from './plans';

export interface DryRunDto {
  id: string;
  planVersionId: string;
  version: number;
  planHash: string;
  datasetHash: string;
  reportHash: string;
  counts: DryRunCounts;
  createdAt: string;
}
export interface QuarantineDto { seq: number; legacyKey: string | null; stage: string; raw: Record<string, unknown>; errors: FieldError[] }

type Row = typeof dryRuns.$inferSelect;
const toDto = (r: Row, version: number): DryRunDto => ({
  id: r.id, planVersionId: r.planVersionId, version, planHash: r.planHash, datasetHash: r.datasetHash,
  reportHash: r.reportHash, counts: r.counts as DryRunCounts, createdAt: r.createdAt.toISOString(),
});

/** Pure recomputation used by dry runs, execution gating and reconciliation. */
export async function computeReport(tx: DbOrTx, workspaceId: string, version: PlanVersionDto) {
  const dataset = await loadDataset(tx, workspaceId);
  try {
    const report = dryRun({ records: dataset.records, plan: version.content.plan, preexistingEmails: dataset.preexistingEmails });
    return { report, datasetHash: dataset.datasetHash, sourceCount: dataset.records.length };
  } catch (err) {
    if (err instanceof InvalidPlanError) {
      throw new AppError('NOT_READY', `Plan version ${version.version} is not valid`, err.issues);
    }
    throw err;
  }
}

export async function runDryRun(workspaceId: string, versionNumber: number, actor: string): Promise<DryRunDto> {
  const version = await getVersion(workspaceId, versionNumber);
  const { report, datasetHash } = await computeReport(db, workspaceId, version);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(dryRuns).values({
      workspaceId, planVersionId: version.id, planHash: report.planHash, datasetHash, reportHash: report.reportHash,
      counts: report.counts,
    }).returning();
    await persistQuarantine(tx, row.id, report);
    await recordEvent(tx, { workspaceId, type: 'dry_run.completed', actor, subjectType: 'dry_run', subjectId: row.id,
      payload: { version: version.version, counts: report.counts, reportHash: report.reportHash } });
    return toDto(row, version.version);
  });
}

async function persistQuarantine(tx: DbOrTx, dryRunId: string, report: DryRunReport) {
  if (!report.quarantine.length) return;
  await tx.insert(quarantineRecords).values(report.quarantine.map((q) => ({
    dryRunId, seq: q.seq, legacyKey: q.legacyKey, stage: q.stage, raw: q.raw, errors: q.errors })));
}

export async function getDryRun(workspaceId: string, id: string): Promise<DryRunDto> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound('Dry run');
  const [row] = await db.select().from(dryRuns).where(and(eq(dryRuns.workspaceId, workspaceId), eq(dryRuns.id, id)));
  if (!row) throw notFound('Dry run');
  const v = await db.query.planVersions.findFirst({ where: (p, { eq: e }) => e(p.id, row.planVersionId) });
  return toDto(row, v?.version ?? 0);
}

export async function latestDryRunFor(tx: DbOrTx, planVersionId: string, version: number): Promise<DryRunDto | null> {
  const [row] = await tx.select().from(dryRuns).where(eq(dryRuns.planVersionId, planVersionId)).orderBy(desc(dryRuns.createdAt)).limit(1);
  return row ? toDto(row, version) : null;
}

export async function listQuarantine(workspaceId: string, dryRunId: string,
  filter: { stage?: string; code?: string; field?: string }): Promise<QuarantineDto[]> {
  await getDryRun(workspaceId, dryRunId);
  const rows = await db.select().from(quarantineRecords).where(eq(quarantineRecords.dryRunId, dryRunId)).orderBy(asc(quarantineRecords.seq));
  return rows
    .map((r) => ({ seq: r.seq, legacyKey: r.legacyKey, stage: r.stage, raw: r.raw as Record<string, unknown>, errors: r.errors as FieldError[] }))
    .filter((q) => (!filter.stage || q.stage === filter.stage)
      && (!filter.code || q.errors.some((e) => e.code === filter.code))
      && (!filter.field || q.errors.some((e) => e.targetField === filter.field || e.sourceField === filter.field)));
}

/** Quotes a CSV cell and neutralises spreadsheet formulas (leading = + - @ tab CR). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const text = String(v);
  const first = text.charCodeAt(0);
  const risky = /^[=+@-]/.test(text) || first === 9 || first === 13;
  const safe = risky ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function quarantineCsv(workspaceId: string, dryRunId: string): Promise<string> {
  const rows = await listQuarantine(workspaceId, dryRunId, {});
  const lines = ['seq,legacy_key,stage,target_field,source_field,source_value,rule,code,message'];
  for (const q of rows) {
    for (const e of q.errors) {
      lines.push([q.seq, csvCell(q.legacyKey), q.stage, e.targetField, csvCell(e.sourceField), csvCell(e.sourceValue),
        csvCell(e.rule), e.code, csvCell(e.message)].join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}
