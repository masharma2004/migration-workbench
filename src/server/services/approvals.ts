import { and, desc, eq, sql } from 'drizzle-orm';
import { validatePlan } from '@/domain/plan';
import { TARGET_SCHEMA_VERSION } from '@/domain/schemas/target';
import { db, type DbOrTx } from '../db/client';
import { approvals, planVersions } from '../db/schema';
import { AppError } from '../errors';
import { recordEvent } from './audit';
import { latestDryRunFor, type DryRunDto } from './dry-runs';
import { getVersion, getVersionById, type PlanVersionDto } from './plans';
import { getWorkspace } from './workspaces';

export interface ReadinessCheck {
  id: 'plan_valid' | 'blocking_questions_answered' | 'dry_run_current';
  label: string;
  passed: boolean;
  detail: string;
}

export interface ApprovalDto {
  id: string; planVersionId: string; version: number; approvedBy: string; note: string | null; planHash: string;
  datasetHash: string; targetSchemaVersion: string; dryRunReportHash: string; createdAt: string;
}

export async function getReadiness(workspaceId: string, versionNumber: number, tx: DbOrTx = db) {
  const ws = await getWorkspace(workspaceId);
  const version = await getVersion(workspaceId, versionNumber, tx);
  const issues = validatePlan(version.content.plan);
  const unanswered = version.content.questions.filter((q) => q.blocking && !q.answer?.trim());
  const latestDryRun = await latestDryRunFor(tx, version.id, version.version);
  const dryRunCurrent = !!latestDryRun && latestDryRun.planHash === version.planHash && latestDryRun.datasetHash === ws.datasetHash;
  const checks: ReadinessCheck[] = [
    { id: 'plan_valid', label: 'Plan passes validation', passed: issues.length === 0,
      detail: issues.length ? `${issues.length} issue(s): ${issues.slice(0, 3).map((i) => i.code).join(', ')}` : 'No issues' },
    { id: 'blocking_questions_answered', label: 'Blocking questions answered', passed: unanswered.length === 0,
      detail: unanswered.length ? `Unanswered: ${unanswered.map((q) => q.id).join(', ')}` : 'All answered' },
    { id: 'dry_run_current', label: 'Dry run exists for this exact version and dataset', passed: dryRunCurrent,
      detail: latestDryRun ? (dryRunCurrent ? `Report ${latestDryRun.reportHash.slice(0, 8)}` : 'Dry run is stale') : 'No dry run yet' },
  ];
  return { version: version.version, ready: checks.every((c) => c.passed), checks, latestDryRun };
}

function toDto(r: typeof approvals.$inferSelect, version: number): ApprovalDto {
  return { id: r.id, planVersionId: r.planVersionId, version, approvedBy: r.approvedBy, note: r.note, planHash: r.planHash,
    datasetHash: r.datasetHash, targetSchemaVersion: r.targetSchemaVersion, dryRunReportHash: r.dryRunReportHash,
    createdAt: r.createdAt.toISOString() };
}

export async function approveVersion(workspaceId: string, versionNumber: number,
  input: { approvedBy: string; note?: string; acknowledgeDryRun: boolean }): Promise<ApprovalDto> {
  const approvedBy = input.approvedBy?.trim();
  if (!approvedBy) throw new AppError('VALIDATION_ERROR', 'approvedBy is required');
  if (input.acknowledgeDryRun !== true) throw new AppError('VALIDATION_ERROR', 'You must acknowledge the dry-run results');

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'ws:' + workspaceId}))`);
    const readiness = await getReadiness(workspaceId, versionNumber, tx);
    if (!readiness.ready || !readiness.latestDryRun) {
      throw new AppError('NOT_READY', `Version ${versionNumber} is not ready for approval`, readiness.checks);
    }
    const ws = await getWorkspace(workspaceId);
    const version = await getVersion(workspaceId, versionNumber, tx);

    const previouslyApproved = await tx.select().from(planVersions)
      .where(and(eq(planVersions.workspaceId, workspaceId), eq(planVersions.status, 'approved')));
    for (const prev of previouslyApproved) {
      await tx.update(planVersions).set({ status: 'superseded' }).where(eq(planVersions.id, prev.id));
      await recordEvent(tx, { workspaceId, type: 'plan.superseded', actor: approvedBy, subjectType: 'plan_version',
        subjectId: prev.id, payload: { version: prev.version, supersededBy: version.version } });
    }
    await tx.update(planVersions).set({ status: 'approved' }).where(eq(planVersions.id, version.id));
    const [row] = await tx.insert(approvals).values({
      workspaceId, planVersionId: version.id, approvedBy, note: input.note?.trim() || null, planHash: version.planHash,
      datasetHash: ws.datasetHash, targetSchemaVersion: TARGET_SCHEMA_VERSION, dryRunReportHash: readiness.latestDryRun.reportHash,
    }).returning();
    await recordEvent(tx, { workspaceId, type: 'plan.approved', actor: approvedBy, subjectType: 'plan_version',
      subjectId: version.id, payload: { version: version.version, planHash: version.planHash,
        dryRunReportHash: row.dryRunReportHash, note: row.note } });
    return toDto(row, version.version);
  });
}

export async function getCurrentApproval(tx: DbOrTx, workspaceId: string): Promise<{ approval: ApprovalDto; version: PlanVersionDto } | null> {
  const [v] = await tx.select().from(planVersions)
    .where(and(eq(planVersions.workspaceId, workspaceId), eq(planVersions.status, 'approved')));
  if (!v) return null;
  const [a] = await tx.select().from(approvals).where(eq(approvals.planVersionId, v.id)).orderBy(desc(approvals.createdAt)).limit(1);
  if (!a) return null;
  return { approval: toDto(a, v.version), version: await getVersionById(tx, v.id) };
}
