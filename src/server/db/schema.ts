import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, date, index, integer, jsonb, pgSchema, serial, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

export const app = pgSchema('app');
export const target = pgSchema('target');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const workspaces = app.table('workspaces', {
  id: text('id').primaryKey(),
  datasetHash: text('dataset_hash').notNull(),
  sourceCount: integer('source_count').notNull(),
  createdAt: createdAt(),
});

export const sourceRecords = app.table('source_records', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  legacyKey: text('legacy_key'),
  raw: jsonb('raw').$type<Record<string, string>>().notNull(),
}, (t) => [uniqueIndex('source_records_pk').on(t.workspaceId, t.seq)]);

export const agentRuns = app.table('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  mode: text('mode').$type<'propose' | 'revise'>().notNull(),
  basePlanVersionId: uuid('base_plan_version_id'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').$type<'queued' | 'running' | 'succeeded' | 'failed'>().notNull(),
  error: text('error'),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  toolCalls: integer('tool_calls').notNull().default(0),
  resultPlanVersionId: uuid('result_plan_version_id'),
  startedAt: createdAt(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('agent_runs_ws').on(t.workspaceId)]);

export const agentSteps = app.table('agent_steps', {
  id: serial('id').primaryKey(),
  agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  step: integer('step').notNull(),
  kind: text('kind').$type<'tool_call' | 'model_text' | 'correction' | 'error'>().notNull(),
  toolName: text('tool_name'),
  args: jsonb('args'),
  result: jsonb('result'),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index('agent_steps_run').on(t.agentRunId, t.step)]);

export const planVersions = app.table('plan_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  parentVersionId: uuid('parent_version_id'),
  author: text('author').$type<'agent' | 'user'>().notNull(),
  status: text('status').$type<'draft' | 'approved' | 'superseded'>().notNull().default('draft'),
  content: jsonb('content').notNull(),
  planHash: text('plan_hash').notNull(),
  agentRunId: uuid('agent_run_id'),
  changeNote: text('change_note'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('plan_versions_ws_version').on(t.workspaceId, t.version)]);

export const approvals = app.table('approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  planVersionId: uuid('plan_version_id').notNull().references(() => planVersions.id),
  approvedBy: text('approved_by').notNull(),
  note: text('note'),
  planHash: text('plan_hash').notNull(),
  datasetHash: text('dataset_hash').notNull(),
  targetSchemaVersion: text('target_schema_version').notNull(),
  dryRunReportHash: text('dry_run_report_hash').notNull(),
  createdAt: createdAt(),
});

export const dryRuns = app.table('dry_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  planVersionId: uuid('plan_version_id').notNull().references(() => planVersions.id),
  planHash: text('plan_hash').notNull(),
  datasetHash: text('dataset_hash').notNull(),
  reportHash: text('report_hash').notNull(),
  counts: jsonb('counts').notNull(),
  createdAt: createdAt(),
}, (t) => [index('dry_runs_version').on(t.planVersionId)]);

export const quarantineRecords = app.table('quarantine_records', {
  id: serial('id').primaryKey(),
  dryRunId: uuid('dry_run_id').notNull().references(() => dryRuns.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  legacyKey: text('legacy_key'),
  stage: text('stage').notNull(),
  raw: jsonb('raw').notNull(),
  errors: jsonb('errors').notNull(),
}, (t) => [index('quarantine_dry_run').on(t.dryRunId, t.seq)]);

export const migrationRuns = app.table('migration_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  planVersionId: uuid('plan_version_id').notNull().references(() => planVersions.id),
  approvalId: uuid('approval_id').notNull().references(() => approvals.id),
  kind: text('kind').$type<'execute' | 'retry'>().notNull(),
  parentRunId: uuid('parent_run_id'),
  attempt: integer('attempt').notNull(),
  status: text('status').$type<'running' | 'succeeded' | 'failed' | 'interrupted' | 'rolled_back'>().notNull(),
  failAfterBatches: integer('fail_after_batches'),
  counts: jsonb('counts').notNull().default({}),
  error: text('error'),
  startedAt: createdAt(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('migration_runs_one_running').on(t.workspaceId).where(sql`status = 'running'`),
  index('migration_runs_ws').on(t.workspaceId),
]);

export const rollbacks = app.table('rollbacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  planVersionId: uuid('plan_version_id').notNull(),
  runIds: jsonb('run_ids').$type<string[]>().notNull(),
  rowsDeleted: integer('rows_deleted').notNull(),
  createdAt: createdAt(),
});

export const reconciliations = app.table('reconciliations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  planVersionId: uuid('plan_version_id'),
  result: text('result').$type<'pass' | 'fail'>().notNull(),
  details: jsonb('details').notNull(),
  createdAt: createdAt(),
});

export const auditEvents = app.table('audit_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  actor: text('actor').notNull(),
  subjectType: text('subject_type'),
  subjectId: text('subject_id'),
  payload: jsonb('payload').notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index('audit_ws').on(t.workspaceId, t.id)]);

export const targetCustomers = target.table('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  legacyId: text('legacy_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  email: text('email').notNull(),
  phoneE164: text('phone_e164'),
  createdOn: date('created_on', { mode: 'string' }).notNull(),
  status: text('status').notNull(),
  countryCode: text('country_code'),
  lifetimeValueCents: bigint('lifetime_value_cents', { mode: 'number' }).notNull(),
  isVip: boolean('is_vip').notNull(),
  marketingOptIn: boolean('marketing_opt_in').notNull(),
  workspaceId: text('_workspace_id').notNull(),
  origin: text('_origin').$type<'preexisting' | 'migrated'>().notNull(),
  runId: uuid('_run_id'),
  rowHash: text('_row_hash').notNull(),
  insertedAt: timestamp('_inserted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('customers_ws_legacy').on(t.workspaceId, t.legacyId),
  uniqueIndex('customers_ws_email').on(t.workspaceId, sql`lower(${t.email})`),
  index('customers_ws_run').on(t.workspaceId, t.runId),
]);
