# Phase 3 — Persistence and Services (Tasks 8–13)

Read `00-index.md` first. All service tests are integration tests against the real Postgres test database (`npm run test:int`; requires `docker compose up -d db`).

Conventions for every service:
- Services take a `workspaceId` and return plain objects; they never return Drizzle internals.
- Every state change writes an audit event in the **same transaction**.
- Errors are thrown as `AppError` (defined in Task 8 so services can use it before the HTTP layer exists).

---

### Task 8: Database schema, migrations, client, AppError, test harness

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/client.ts`, `drizzle.config.ts`, `drizzle/` (generated), `drizzle/XXXX_constraints.sql` (custom), `scripts/migrate.ts`, `src/server/db/migrate.ts`, `src/server/errors.ts`, `tests/integration/global-setup.ts`, `tests/integration/helpers.ts`
- Test: `tests/integration/db.test.ts`

**Interfaces:**
- Produces:
  - Drizzle tables: `workspaces`, `sourceRecords`, `planVersions`, `approvals`, `agentRuns`, `agentSteps`, `dryRuns`, `quarantineRecords`, `migrationRuns`, `rollbacks`, `reconciliations`, `auditEvents` (schema `app`), `targetCustomers` (schema `target`)
  - `db` (Drizzle instance), `type Db = typeof db`, `type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]`, `type DbOrTx = Db | Tx`, `closeDb()`
  - `runMigrations(): Promise<void>`
  - `class AppError extends Error { code: ErrorCode; status: number; details?: unknown }`, `type ErrorCode`, helpers `notFound(what)`, `conflict(code, message, details?)`
  - Test helpers: `resetDatabase()`, `createTestWorkspace()` (Task 9 adds the latter)

- [ ] **Step 1: AppError** — `src/server/errors.ts`:

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'NOT_APPROVED' | 'APPROVAL_STALE' | 'ROLLBACK_REQUIRED'
  | 'RUN_IN_PROGRESS' | 'NOTHING_TO_ROLLBACK' | 'NOT_READY' | 'LIMIT_EXCEEDED' | 'RATE_LIMITED'
  | 'LLM_UNAVAILABLE' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, NOT_FOUND: 404, NOT_APPROVED: 409, APPROVAL_STALE: 409, ROLLBACK_REQUIRED: 409,
  RUN_IN_PROGRESS: 409, NOTHING_TO_ROLLBACK: 409, NOT_READY: 409, LIMIT_EXCEEDED: 413, RATE_LIMITED: 429,
  LLM_UNAVAILABLE: 503, INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);
export const conflict = (code: ErrorCode, message: string, details?: unknown) => new AppError(code, message, details);
```

- [ ] **Step 2: Schema** — `src/server/db/schema.ts`:

```ts
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
```

- [ ] **Step 3: Drizzle config and client**

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['app', 'target'],
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://workbench:workbench@localhost:5433/workbench' },
});
```

`src/server/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client = globalForDb.pg ?? postgres(url, { max: 10, onnotice: () => {} });
if (process.env.NODE_ENV !== 'production') globalForDb.pg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
  globalForDb.pg = undefined;
}
```

`src/server/db/migrate.ts`:

```ts
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
}
```

`scripts/migrate.ts`:

```ts
import { closeDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';

runMigrations()
  .then(() => console.log('migrations applied'))
  .finally(() => closeDb());
```

- [ ] **Step 4: Generate migrations, then add a custom migration for constraints and the audit trigger**

Run: `npx drizzle-kit generate --name init` then `npx drizzle-kit generate --custom --name constraints`
Put this in the generated `drizzle/0001_constraints.sql`:

```sql
ALTER TABLE target.customers
  ADD CONSTRAINT customers_status_chk CHECK (status IN ('active','inactive','closed')),
  ADD CONSTRAINT customers_ltv_chk CHECK (lifetime_value_cents >= 0),
  ADD CONSTRAINT customers_origin_chk CHECK (_origin IN ('preexisting','migrated'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON app.audit_events
  FOR EACH ROW EXECUTE FUNCTION app.audit_events_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON app.audit_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0 AND current_setting('app.allow_audit_delete', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION app.audit_events_immutable();
```

The delete trigger allows cascade deletes only when the session sets `app.allow_audit_delete = 'on'` (used by test reset and workspace cleanup); direct deletes are refused.

Check the generated `0000_init.sql` begins with `CREATE SCHEMA "app"` and `CREATE SCHEMA "target"`; if not, add `CREATE SCHEMA IF NOT EXISTS "app";` and `CREATE SCHEMA IF NOT EXISTS "target";` with `--> statement-breakpoint` at its top.

- [ ] **Step 5: Integration harness**

`tests/integration/global-setup.ts`:

```ts
import postgres from 'postgres';

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST ?? 'postgres://workbench:workbench@localhost:5433/workbench_test';
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS target CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await sql.end();
  process.env.DATABASE_URL = url;
  const { runMigrations } = await import('../../src/server/db/migrate');
  const { closeDb } = await import('../../src/server/db/client');
  await runMigrations();
  await closeDb();
}
```

`tests/integration/helpers.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';

export async function resetDatabase(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.allow_audit_delete = 'on'`);
    await tx.execute(sql`TRUNCATE app.workspaces, target.customers CASCADE`);
  });
}
```

(TRUNCATE does not fire row-level DELETE triggers, so the `SET LOCAL` is belt-and-braces.)

- [ ] **Step 6: Write the DB smoke test** — `tests/integration/db.test.ts`:

```ts
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
    await expect(db.execute(sql`update app.audit_events set type = 'x' where id = ${ev.id}`)).rejects.toThrow(/append-only/);
    await expect(db.execute(sql`delete from app.audit_events where id = ${ev.id}`)).rejects.toThrow(/append-only/);
  });
});
```

- [ ] **Step 7: Run**

Run: `npm run test:int`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/server drizzle drizzle.config.ts scripts/migrate.ts tests/integration && git commit -m "feat(db): schema, migrations, append-only audit, integration harness"
```

---

### Task 9: Workspaces, dataset loading, target store, audit

**Files:**
- Create: `src/server/services/audit.ts`, `src/server/services/target-store.ts`, `src/server/services/workspaces.ts`, `src/server/services/dataset.ts`
- Modify: `tests/integration/helpers.ts` (add `createTestWorkspace`)
- Test: `tests/integration/workspaces.test.ts`

**Interfaces:**
- Consumes: schema, `db`, `AppError`, seed (Task 7), `hashOf`, `rowHash`, `MAX_SOURCE_RECORDS`
- Produces:
  - `recordEvent(tx: DbOrTx, e: { workspaceId: string; type: AuditType; actor: string; subjectType?: string; subjectId?: string; payload?: Record<string, unknown> }): Promise<void>`
  - `type AuditType = 'workspace.created' | 'agent_run.started' | 'agent_run.succeeded' | 'agent_run.failed' | 'plan.version_created' | 'dry_run.completed' | 'plan.approved' | 'plan.superseded' | 'execution.started' | 'execution.succeeded' | 'execution.failed' | 'execution.interrupted' | 'rollback.completed' | 'reconciliation.completed'`
  - `listEvents(workspaceId: string, opts?: { type?: string; limit?: number }): Promise<AuditEventDto[]>` where `AuditEventDto = { id: number; type: string; actor: string; subjectType: string | null; subjectId: string | null; payload: Record<string, unknown>; createdAt: string }`
  - target store: `dbRowToTarget(r): TargetRow`, `targetToDbValues(row, meta)`, `insertPreexisting(tx, ws, rows)`, `listTargetRows(ws, page, pageSize)`, `migratedRows(tx, ws, runIds): { legacyId: string; row: TargetRow; storedHash: string }[]`, `preexistingRows(tx, ws): TargetRow[]`, `preexistingEmails(tx, ws): string[]`, `insertMigratedBatch(tx, ws, runId, rows: AcceptedRow[]): Promise<string[]>` (returns inserted legacy ids), `storedHashes(tx, ws, legacyIds): Map<string, string>`, `deleteMigrated(tx, ws, runIds): Promise<number>`
  - workspaces: `createWorkspace(): Promise<{ id: string }>`, `getWorkspace(id): Promise<WorkspaceRow>` (throws NOT_FOUND), `getOverview(id): Promise<WorkspaceOverview>`, `listSourceRecords(id, page, pageSize)`
  - dataset: `loadDataset(tx: DbOrTx, workspaceId): Promise<{ records: SourceRecordInput[]; datasetHash: string; preexistingEmails: string[] }>`, `datasetHashOf(records: Record<string, string>[]): string`

- [ ] **Step 1: Write failing tests** — `tests/integration/workspaces.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project integration tests/integration/workspaces.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/server/services/audit.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client';
import { auditEvents } from '../db/schema';

export type AuditType =
  | 'workspace.created' | 'agent_run.started' | 'agent_run.succeeded' | 'agent_run.failed'
  | 'plan.version_created' | 'dry_run.completed' | 'plan.approved' | 'plan.superseded'
  | 'execution.started' | 'execution.succeeded' | 'execution.failed' | 'execution.interrupted'
  | 'rollback.completed' | 'reconciliation.completed';

export interface AuditEventDto {
  id: number;
  type: string;
  actor: string;
  subjectType: string | null;
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function recordEvent(
  tx: DbOrTx,
  e: { workspaceId: string; type: AuditType; actor: string; subjectType?: string; subjectId?: string; payload?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(auditEvents).values({
    workspaceId: e.workspaceId, type: e.type, actor: e.actor,
    subjectType: e.subjectType ?? null, subjectId: e.subjectId ?? null, payload: e.payload ?? {},
  });
}

export async function listEvents(workspaceId: string, opts: { type?: string; limit?: number } = {}): Promise<AuditEventDto[]> {
  const where = opts.type
    ? and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.type, opts.type))
    : eq(auditEvents.workspaceId, workspaceId);
  const rows = await db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.id)).limit(opts.limit ?? 500);
  return rows.reverse().map((r) => ({
    id: r.id, type: r.type, actor: r.actor, subjectType: r.subjectType, subjectId: r.subjectId,
    payload: r.payload as Record<string, unknown>, createdAt: r.createdAt.toISOString(),
  }));
}
```

`src/server/services/target-store.ts`:

```ts
import { and, count, eq, inArray, sql } from 'drizzle-orm';
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

export const _sql = sql; // re-export guard so tree-shaking keeps drizzle sql import stable in tests
```

Remove the last `_sql` line if lint flags it as unused; it is not required.

`src/server/services/dataset.ts`:

```ts
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
```

`src/server/services/workspaces.ts`:

```ts
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
```

Add to `tests/integration/helpers.ts`:

```ts
import { createWorkspace } from '@/server/services/workspaces';

export async function createTestWorkspace(): Promise<string> {
  return (await createWorkspace()).id;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project integration tests/integration/workspaces.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services tests/integration && git commit -m "feat(services): workspaces, dataset loading, target store, audit log"
```

---

### Task 10: Plan versions and dry runs

**Files:**
- Create: `src/server/services/plans.ts`, `src/server/services/dry-runs.ts`
- Test: `tests/integration/plans.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 9
- Produces:
  - `interface PlanVersionDto { id: string; version: number; parentVersionId: string | null; author: 'agent' | 'user'; status: 'draft' | 'approved' | 'superseded'; content: VersionContent; planHash: string; agentRunId: string | null; changeNote: string | null; createdAt: string; issues: PlanIssue[] }`
  - `createVersion(tx: DbOrTx, input: { workspaceId: string; content: unknown; author: 'agent' | 'user'; parentVersionId?: string | null; agentRunId?: string | null; changeNote?: string | null; actor: string }): Promise<PlanVersionDto>` (validates content with `versionContentSchema`; throws `VALIDATION_ERROR` with zod issues)
  - `listVersions(workspaceId): Promise<PlanVersionDto[]>` (newest first)
  - `getVersion(workspaceId, version: number): Promise<PlanVersionDto>` / `getVersionById(tx, id)`
  - `diffVersions(workspaceId, from: number, to: number): Promise<PlanDiff>`
  - `runDryRun(workspaceId, version: number, actor: string): Promise<DryRunDto>`
  - `interface DryRunDto { id: string; planVersionId: string; version: number; planHash: string; datasetHash: string; reportHash: string; counts: DryRunCounts; createdAt: string }`
  - `getDryRun(workspaceId, dryRunId): Promise<DryRunDto>`, `latestDryRunFor(tx, planVersionId): Promise<DryRunDto | null>`
  - `listQuarantine(workspaceId, dryRunId, filter: { stage?: string; code?: string; field?: string }): Promise<QuarantineDto[]>` where `QuarantineDto = { seq; legacyKey; stage; raw; errors: FieldError[] }`
  - `quarantineCsv(workspaceId, dryRunId): Promise<string>`

- [ ] **Step 1: Write failing tests** — `tests/integration/plans.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { listEvents } from '@/server/services/audit';
import { getDryRun, listQuarantine, quarantineCsv, runDryRun } from '@/server/services/dry-runs';
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project integration tests/integration/plans.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/server/services/plans.ts`:

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { diffPlans, planHash, validatePlan, versionContentSchema, type PlanIssue, type VersionContent } from '@/domain/plan';
import { db, type DbOrTx } from '../db/client';
import { planVersions } from '../db/schema';
import { AppError, notFound } from '../errors';
import { recordEvent } from './audit';
import { getWorkspace } from './workspaces';

type Row = typeof planVersions.$inferSelect;

export interface PlanVersionDto {
  id: string;
  version: number;
  parentVersionId: string | null;
  author: 'agent' | 'user';
  status: 'draft' | 'approved' | 'superseded';
  content: VersionContent;
  planHash: string;
  agentRunId: string | null;
  changeNote: string | null;
  createdAt: string;
  issues: PlanIssue[];
}

export function toDto(r: Row): PlanVersionDto {
  const content = r.content as VersionContent;
  return {
    id: r.id, version: r.version, parentVersionId: r.parentVersionId, author: r.author, status: r.status, content,
    planHash: r.planHash, agentRunId: r.agentRunId, changeNote: r.changeNote, createdAt: r.createdAt.toISOString(),
    issues: validatePlan(content.plan),
  };
}

export async function createVersion(tx: DbOrTx, input: {
  workspaceId: string; content: unknown; author: 'agent' | 'user'; parentVersionId?: string | null;
  agentRunId?: string | null; changeNote?: string | null; actor: string;
}): Promise<PlanVersionDto> {
  const parsed = versionContentSchema.safeParse(input.content);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Plan content is malformed', parsed.error.issues);
  }
  const content = parsed.data;
  const run = async (t: DbOrTx) => {
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${'plan:' + input.workspaceId}))`);
    const [last] = await t.select({ version: planVersions.version }).from(planVersions)
      .where(eq(planVersions.workspaceId, input.workspaceId)).orderBy(desc(planVersions.version)).limit(1);
    const [row] = await t.insert(planVersions).values({
      workspaceId: input.workspaceId, version: (last?.version ?? 0) + 1, parentVersionId: input.parentVersionId ?? null,
      author: input.author, content, planHash: planHash(content.plan), agentRunId: input.agentRunId ?? null,
      changeNote: input.changeNote ?? null,
    }).returning();
    await recordEvent(t, { workspaceId: input.workspaceId, type: 'plan.version_created', actor: input.actor,
      subjectType: 'plan_version', subjectId: row.id,
      payload: { version: row.version, author: row.author, planHash: row.planHash, parentVersionId: row.parentVersionId,
        changeNote: row.changeNote } });
    return toDto(row);
  };
  // Advisory xact locks need a transaction; open one if we were handed the root db.
  return tx === db ? db.transaction(run) : run(tx);
}

export async function listVersions(workspaceId: string): Promise<PlanVersionDto[]> {
  await getWorkspace(workspaceId);
  const rows = await db.select().from(planVersions).where(eq(planVersions.workspaceId, workspaceId)).orderBy(desc(planVersions.version));
  return rows.map(toDto);
}

export async function getVersion(workspaceId: string, version: number, tx: DbOrTx = db): Promise<PlanVersionDto> {
  const [row] = await tx.select().from(planVersions)
    .where(and(eq(planVersions.workspaceId, workspaceId), eq(planVersions.version, version)));
  if (!row) throw notFound(`Plan version ${version}`);
  return toDto(row);
}

export async function getVersionById(tx: DbOrTx, id: string): Promise<PlanVersionDto> {
  const [row] = await tx.select().from(planVersions).where(eq(planVersions.id, id));
  if (!row) throw notFound('Plan version');
  return toDto(row);
}

export async function diffVersions(workspaceId: string, from: number, to: number) {
  const [a, b] = await Promise.all([getVersion(workspaceId, from), getVersion(workspaceId, to)]);
  return diffPlans(a.content.plan, b.content.plan);
}
```

`src/server/services/dry-runs.ts`:

```ts
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

const csvCell = (v: unknown) => (v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`);

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
```

The Drizzle relational query `db.query.planVersions` works because the client is created with `{ schema }`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project integration tests/integration/plans.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services tests/integration/plans.test.ts && git commit -m "feat(services): immutable plan versions, diff, persisted dry runs and quarantine"
```

---

### Task 11: Approval readiness and approval

**Files:**
- Create: `src/server/services/approvals.ts`
- Test: `tests/integration/approvals.test.ts`

**Interfaces:**
- Consumes: Tasks 9–10, `TARGET_SCHEMA_VERSION`
- Produces:
  - `interface ReadinessCheck { id: 'plan_valid' | 'blocking_questions_answered' | 'dry_run_current'; label: string; passed: boolean; detail: string }`
  - `getReadiness(workspaceId, version: number, tx?: DbOrTx): Promise<{ version: number; ready: boolean; checks: ReadinessCheck[]; latestDryRun: DryRunDto | null }>`
  - `approveVersion(workspaceId, version: number, input: { approvedBy: string; note?: string; acknowledgeDryRun: boolean }): Promise<ApprovalDto>`
  - `interface ApprovalDto { id: string; planVersionId: string; version: number; approvedBy: string; note: string | null; planHash: string; datasetHash: string; targetSchemaVersion: string; dryRunReportHash: string; createdAt: string }`
  - `getCurrentApproval(tx: DbOrTx, workspaceId): Promise<{ approval: ApprovalDto; version: PlanVersionDto } | null>`

- [ ] **Step 1: Write failing tests** — `tests/integration/approvals.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { approveVersion, getCurrentApproval, getReadiness } from '@/server/services/approvals';
import { listEvents } from '@/server/services/audit';
import { runDryRun } from '@/server/services/dry-runs';
import { createVersion, getVersion } from '@/server/services/plans';
import { REFERENCE_PLAN } from '@/seed/reference-plan';
import { createTestWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

const blockingQ = (answer?: string) => ({ id: 'q-date', text: 'US or EU dates?', blocking: true, relatedFields: ['signup_date'],
  suggestedOptions: ['US', 'EU'], assumption: 'US', ...(answer ? { answer } : {}) });
const content = (questions: unknown[] = []) => ({ plan: REFERENCE_PLAN, risks: [], incompatibilities: [], questions, summary: '' });
const approve = (ws: string, v: number) => approveVersion(ws, v, { approvedBy: 'Reviewer', acknowledgeDryRun: true });

describe('readiness', () => {
  it('requires a valid plan, answered blocking questions and a current dry run', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: content([blockingQ()]), author: 'agent', actor: 'agent' });
    let r = await getReadiness(ws, 1);
    expect(r.ready).toBe(false);
    expect(Object.fromEntries(r.checks.map((c) => [c.id, c.passed]))).toEqual({
      plan_valid: true, blocking_questions_answered: false, dry_run_current: false });

    await createVersion(db, { workspaceId: ws, content: content([blockingQ('US')]), author: 'user', actor: 'u' });
    await runDryRun(ws, 2, 'u');
    r = await getReadiness(ws, 2);
    expect(r.ready).toBe(true);
    expect(r.latestDryRun?.counts.accepted).toBe(177);
  });
});

describe('approveVersion', () => {
  it('refuses when not ready, or without acknowledgement', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 'u' });
    await expect(approve(ws, 1)).rejects.toMatchObject({ code: 'NOT_READY' });
    await runDryRun(ws, 1, 'u');
    await expect(approveVersion(ws, 1, { approvedBy: 'R', acknowledgeDryRun: false })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(approveVersion(ws, 1, { approvedBy: '  ', acknowledgeDryRun: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('binds approval to hashes and supersedes the previously approved version', async () => {
    const ws = await createTestWorkspace();
    await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 'u' });
    await createVersion(db, { workspaceId: ws, content: content(), author: 'user', actor: 'u' });
    await runDryRun(ws, 1, 'u');
    await runDryRun(ws, 2, 'u');
    const a1 = await approve(ws, 1);
    expect(a1).toMatchObject({ version: 1, approvedBy: 'Reviewer', targetSchemaVersion: 'target-v1' });
    await approve(ws, 2);
    expect((await getVersion(ws, 1)).status).toBe('superseded');
    expect((await getVersion(ws, 2)).status).toBe('approved');
    expect((await getCurrentApproval(db, ws))?.version.version).toBe(2);
    const types = (await listEvents(ws)).map((e) => e.type);
    expect(types.filter((t) => t === 'plan.approved')).toHaveLength(2);
    expect(types).toContain('plan.superseded');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project integration tests/integration/approvals.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — `src/server/services/approvals.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project integration tests/integration/approvals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/approvals.ts tests/integration/approvals.test.ts && git commit -m "feat(services): deterministic approval readiness gate bound to hashes"
```

---

### Task 12: Execution, idempotent retry, failure simulation, rollback

**Files:**
- Create: `src/server/services/executions.ts`, `src/server/services/rollback.ts`
- Modify: `tests/integration/helpers.ts` (add `approvedWorkspace()`)
- Test: `tests/integration/executions.test.ts`

**Interfaces:**
- Consumes: Tasks 9–11, `EXECUTION_BATCH_SIZE`, `TARGET_SCHEMA_VERSION`, `computeReport`
- Produces:
  - `interface RunCounts { planned: number; inserted: number; alreadyPresent: number; conflict: number; batchesCommitted: number }`
  - `interface MigrationRunDto { id; planVersionId; version: number; kind: 'execute' | 'retry'; parentRunId: string | null; attempt: number; status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'rolled_back'; failAfterBatches: number | null; counts: RunCounts; error: string | null; startedAt: string; finishedAt: string | null }`
  - `executeMigration(workspaceId, input: { failAfterBatches?: number | null; actor: string }): Promise<MigrationRunDto>`
  - `listRuns(workspaceId): Promise<MigrationRunDto[]>` (newest first)
  - `activeRuns(tx, workspaceId): Promise<MigrationRunRow[]>` (status not `rolled_back`)
  - `markInterruptedRuns(tx, workspaceId?: string): Promise<number>`
  - `rollbackMigration(workspaceId, actor: string): Promise<{ id: string; rowsDeleted: number; runIds: string[]; version: number }>`

- [ ] **Step 1: Write failing tests** — `tests/integration/executions.test.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { migrationRuns, targetCustomers } from '@/server/db/schema';
import { approveVersion } from '@/server/services/approvals';
import { listEvents } from '@/server/services/audit';
import { runDryRun } from '@/server/services/dry-runs';
import { executeMigration, listRuns, markInterruptedRuns } from '@/server/services/executions';
import { createVersion } from '@/server/services/plans';
import { rollbackMigration } from '@/server/services/rollback';
import { REFERENCE_PLAN } from '@/seed/reference-plan';
import { approvedWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

const migratedCount = async (ws: string) => (await db.select().from(targetCustomers)
  .where(and(eq(targetCustomers.workspaceId, ws), eq(targetCustomers.origin, 'migrated')))).length;
const distinctLegacy = async (ws: string) => (await db.execute<{ n: number }>(sql`
  select count(distinct legacy_id)::int as n from target.customers where _workspace_id = ${ws} and _origin = 'migrated'`))[0].n;

describe('executeMigration', () => {
  it('refuses without an approved version', async () => {
    const ws = await approvedWorkspace({ approve: false });
    await expect(executeMigration(ws, { actor: 'u' })).rejects.toMatchObject({ code: 'NOT_APPROVED' });
  });

  it('inserts all accepted rows in batches and records history', async () => {
    const ws = await approvedWorkspace();
    const run = await executeMigration(ws, { actor: 'u' });
    expect(run).toMatchObject({ kind: 'execute', attempt: 1, status: 'succeeded',
      counts: { planned: 177, inserted: 177, alreadyPresent: 0, conflict: 0, batchesCommitted: 4 } });
    expect(await migratedCount(ws)).toBe(177);
    const types = (await listEvents(ws)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['execution.started', 'execution.succeeded']));
  });

  it('a simulated mid-run failure keeps committed batches; retry finishes with zero duplicates', async () => {
    const ws = await approvedWorkspace();
    const failed = await executeMigration(ws, { actor: 'u', failAfterBatches: 2 });
    expect(failed).toMatchObject({ status: 'failed', counts: { inserted: 100, batchesCommitted: 2 } });
    expect(failed.error).toMatch(/Simulated failure after 2 batches/);
    expect(await migratedCount(ws)).toBe(100);

    const retry = await executeMigration(ws, { actor: 'u' });
    expect(retry).toMatchObject({ kind: 'retry', attempt: 2, parentRunId: failed.id, status: 'succeeded',
      counts: { planned: 177, inserted: 77, alreadyPresent: 100, conflict: 0 } });
    const again = await executeMigration(ws, { actor: 'u' });
    expect(again.counts).toMatchObject({ inserted: 0, alreadyPresent: 177 });
    expect(await migratedCount(ws)).toBe(177);
    expect(await distinctLegacy(ws)).toBe(177);
  });

  it('allows only one concurrent run per workspace', async () => {
    const ws = await approvedWorkspace();
    const results = await Promise.allSettled([executeMigration(ws, { actor: 'a' }), executeMigration(ws, { actor: 'b' })]);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // Either the second waits and becomes a no-op retry, or it is refused while the first runs.
    if (rejected.length) {
      expect(rejected[0].reason).toMatchObject({ code: 'RUN_IN_PROGRESS' });
      expect(fulfilled).toHaveLength(1);
    }
    expect(await distinctLegacy(ws)).toBe(177);
    expect(await migratedCount(ws)).toBe(177);
  });

  it('marks stuck running runs as interrupted, and a retry then completes (review focus 5)', async () => {
    const ws = await approvedWorkspace();
    const failed = await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    await db.update(migrationRuns).set({ status: 'running' }).where(eq(migrationRuns.id, failed.id)); // simulate crash
    expect(await markInterruptedRuns(db, ws)).toBe(1);
    const retry = await executeMigration(ws, { actor: 'u' });
    expect(retry.counts).toMatchObject({ inserted: 127, alreadyPresent: 50 });
    expect((await listRuns(ws))[1].status).toBe('interrupted');
  });

  it('refuses a different plan version until the active migration is rolled back', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    const edited = structuredClone(REFERENCE_PLAN);
    edited.mappings.find((m) => m.targetField === 'is_vip')!.rationale = 'v2';
    edited.mappings.find((m) => m.targetField === 'marketing_opt_in')!.transforms = [{ rule: 'default_value', params: { value: true } }];
    await createVersion(db, { workspaceId: ws, content: { plan: edited }, author: 'user', actor: 'u' });
    await runDryRun(ws, 2, 'u');
    await approveVersion(ws, 2, { approvedBy: 'R', acknowledgeDryRun: true });
    await expect(executeMigration(ws, { actor: 'u' })).rejects.toMatchObject({ code: 'ROLLBACK_REQUIRED' });
    await rollbackMigration(ws, 'u');
    const run = await executeMigration(ws, { actor: 'u' });
    expect(run).toMatchObject({ version: 2, kind: 'execute', counts: { inserted: 177 } });
  });

  it('refuses when the approved dry-run report no longer matches (APPROVAL_STALE)', async () => {
    const ws = await approvedWorkspace();
    // A new pre-existing customer appears in the target and collides with a source email → report changes.
    await db.execute(sql`insert into target.customers (first_name, email, created_on, status, lifetime_value_cents, is_vip,
      marketing_opt_in, _workspace_id, _origin, _row_hash)
      select 'New', email, '2024-01-01', 'active', 0, false, false, ${ws}, 'preexisting', 'x'
      from (select lower(raw->>'email') as email from app.source_records where workspace_id = ${ws} and seq = 1) s`);
    await expect(executeMigration(ws, { actor: 'u' })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
  });
});

describe('rollbackMigration', () => {
  it('removes only migrated rows of active runs, leaves pre-existing rows, and is not repeatable', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    await executeMigration(ws, { actor: 'u' });
    const rb = await rollbackMigration(ws, 'u');
    expect(rb.rowsDeleted).toBe(177);
    expect(rb.runIds).toHaveLength(2);
    expect(await migratedCount(ws)).toBe(0);
    const pre = await db.select().from(targetCustomers).where(and(eq(targetCustomers.workspaceId, ws), eq(targetCustomers.origin, 'preexisting')));
    expect(pre).toHaveLength(8);
    expect((await listRuns(ws)).every((r) => r.status === 'rolled_back')).toBe(true);
    await expect(rollbackMigration(ws, 'u')).rejects.toMatchObject({ code: 'NOTHING_TO_ROLLBACK' });
    expect((await listEvents(ws)).map((e) => e.type)).toContain('rollback.completed');
  });
});
```

Add to `tests/integration/helpers.ts`:

```ts
import { approveVersion } from '@/server/services/approvals';
import { runDryRun } from '@/server/services/dry-runs';
import { createVersion } from '@/server/services/plans';
import { REFERENCE_PLAN } from '@/seed/reference-plan';
import { db } from '@/server/db/client';

/** Workspace with reference plan v1, a dry run, and (by default) an approval. */
export async function approvedWorkspace(opts: { approve?: boolean } = {}): Promise<string> {
  const ws = await createTestWorkspace();
  await createVersion(db, { workspaceId: ws, content: { plan: REFERENCE_PLAN }, author: 'user', actor: 'test' });
  await runDryRun(ws, 1, 'test');
  if (opts.approve !== false) await approveVersion(ws, 1, { approvedBy: 'Test Reviewer', acknowledgeDryRun: true });
  return ws;
}
```

(Merge the `db` import with the existing one at the top of the file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project integration tests/integration/executions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/server/services/executions.ts`:

```ts
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { EXECUTION_BATCH_SIZE } from '@/domain/limits';
import { TARGET_SCHEMA_VERSION } from '@/domain/schemas/target';
import { logger } from '../log';
import { db, type DbOrTx } from '../db/client';
import { migrationRuns, planVersions } from '../db/schema';
import { AppError } from '../errors';
import { getCurrentApproval } from './approvals';
import { recordEvent } from './audit';
import { computeReport } from './dry-runs';
import { insertMigratedBatch, storedHashes } from './target-store';
import { getWorkspace } from './workspaces';

export interface RunCounts { planned: number; inserted: number; alreadyPresent: number; conflict: number; batchesCommitted: number }
type RunRow = typeof migrationRuns.$inferSelect;
export interface MigrationRunDto {
  id: string; planVersionId: string; version: number; kind: 'execute' | 'retry'; parentRunId: string | null; attempt: number;
  status: RunRow['status']; failAfterBatches: number | null; counts: RunCounts; error: string | null;
  startedAt: string; finishedAt: string | null;
}

const emptyCounts = (): RunCounts => ({ planned: 0, inserted: 0, alreadyPresent: 0, conflict: 0, batchesCommitted: 0 });
const lockWorkspace = (tx: DbOrTx, ws: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'ws:' + ws}))`);

async function toDto(r: RunRow): Promise<MigrationRunDto> {
  const [v] = await db.select({ version: planVersions.version }).from(planVersions).where(eq(planVersions.id, r.planVersionId));
  return { id: r.id, planVersionId: r.planVersionId, version: v?.version ?? 0, kind: r.kind, parentRunId: r.parentRunId,
    attempt: r.attempt, status: r.status, failAfterBatches: r.failAfterBatches, counts: { ...emptyCounts(), ...(r.counts as RunCounts) },
    error: r.error, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null };
}

export async function activeRuns(tx: DbOrTx, workspaceId: string): Promise<RunRow[]> {
  return tx.select().from(migrationRuns)
    .where(and(eq(migrationRuns.workspaceId, workspaceId), ne(migrationRuns.status, 'rolled_back')))
    .orderBy(desc(migrationRuns.attempt));
}

/** Marks runs left in `running` (e.g. after a crash) as interrupted. Optional workspace scope; optional age threshold. */
export async function markInterruptedRuns(tx: DbOrTx, workspaceId?: string, olderThanMs = 0): Promise<number> {
  const conditions = [eq(migrationRuns.status, 'running')];
  if (workspaceId) conditions.push(eq(migrationRuns.workspaceId, workspaceId));
  if (olderThanMs > 0) conditions.push(lt(migrationRuns.startedAt, new Date(Date.now() - olderThanMs)));
  const rows = await tx.update(migrationRuns)
    .set({ status: 'interrupted', error: 'Interrupted (process stopped before the run finished)', finishedAt: new Date() })
    .where(and(...conditions)).returning();
  for (const r of rows) {
    await recordEvent(tx, { workspaceId: r.workspaceId, type: 'execution.interrupted', actor: 'system',
      subjectType: 'migration_run', subjectId: r.id, payload: { attempt: r.attempt } });
  }
  return rows.length;
}

class SimulatedFailure extends Error {}

export async function executeMigration(workspaceId: string, input: { failAfterBatches?: number | null; actor: string }): Promise<MigrationRunDto> {
  const ws = await getWorkspace(workspaceId);
  const failAfter = input.failAfterBatches ?? null;
  if (failAfter !== null && (!Number.isInteger(failAfter) || failAfter < 0)) {
    throw new AppError('VALIDATION_ERROR', 'failAfterBatches must be a non-negative integer');
  }

  // Phase 1: gate checks + claim the run, under the workspace lock.
  const { run, report } = await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await markInterruptedRuns(tx, workspaceId, 10 * 60_000);
    const [running] = await tx.select().from(migrationRuns)
      .where(and(eq(migrationRuns.workspaceId, workspaceId), eq(migrationRuns.status, 'running')));
    if (running) throw new AppError('RUN_IN_PROGRESS', 'A migration run is already in progress for this workspace');

    const current = await getCurrentApproval(tx, workspaceId);
    if (!current) throw new AppError('NOT_APPROVED', 'No approved plan version; approve a version before executing');
    const { approval, version } = current;

    const stale: string[] = [];
    if (approval.planHash !== version.planHash) stale.push('plan changed');
    if (approval.datasetHash !== ws.datasetHash) stale.push('dataset changed');
    if (approval.targetSchemaVersion !== TARGET_SCHEMA_VERSION) stale.push('target schema changed');
    const { report: rep, datasetHash } = await computeReport(tx, workspaceId, version);
    if (datasetHash !== approval.datasetHash) stale.push('dataset hash mismatch');
    if (rep.reportHash !== approval.dryRunReportHash) stale.push('dry-run result differs from the approved one');
    if (stale.length) {
      throw new AppError('APPROVAL_STALE', `Approval of version ${version.version} is stale: ${stale.join('; ')}. Re-run the dry run and approve again.`, stale);
    }

    const active = await activeRuns(tx, workspaceId);
    if (active.some((r) => r.planVersionId !== version.id)) {
      throw new AppError('ROLLBACK_REQUIRED', 'Target contains rows from a different plan version; roll back before executing this version');
    }
    const parent = active[0] ?? null;
    const [created] = await tx.insert(migrationRuns).values({
      workspaceId, planVersionId: version.id, approvalId: approval.id, kind: parent ? 'retry' : 'execute',
      parentRunId: parent?.id ?? null, attempt: (parent?.attempt ?? 0) + 1, status: 'running', failAfterBatches: failAfter,
      counts: { ...emptyCounts(), planned: rep.accepted.length },
    }).returning();
    await recordEvent(tx, { workspaceId, type: 'execution.started', actor: input.actor, subjectType: 'migration_run',
      subjectId: created.id, payload: { kind: created.kind, attempt: created.attempt, version: version.version,
        planned: rep.accepted.length, failAfterBatches: failAfter } });
    return { run: created, report: rep };
  });

  // Phase 2: insert in batches, each batch its own transaction.
  const counts: RunCounts = { ...emptyCounts(), planned: report.accepted.length };
  const log = logger.child({ component: 'execution', workspaceId, runId: run.id });
  let error: string | null = null;
  try {
    for (let i = 0; i < report.accepted.length; i += EXECUTION_BATCH_SIZE) {
      if (failAfter !== null && counts.batchesCommitted >= failAfter) {
        throw new SimulatedFailure(`Simulated failure after ${failAfter} batches`);
      }
      const batch = report.accepted.slice(i, i + EXECUTION_BATCH_SIZE);
      await db.transaction(async (tx) => {
        const inserted = new Set(await insertMigratedBatch(tx, workspaceId, run.id, batch));
        const skipped = batch.filter((a) => !inserted.has(a.legacyId));
        const hashes = await storedHashes(tx, workspaceId, skipped.map((a) => a.legacyId));
        counts.inserted += inserted.size;
        for (const a of skipped) {
          if (hashes.get(a.legacyId) === a.rowHash) counts.alreadyPresent += 1;
          else counts.conflict += 1;
        }
        counts.batchesCommitted += 1;
        await tx.update(migrationRuns).set({ counts }).where(eq(migrationRuns.id, run.id));
      });
      log.info({ batch: counts.batchesCommitted, inserted: counts.inserted, alreadyPresent: counts.alreadyPresent }, 'batch committed');
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    log.warn({ err: error, counts }, 'run failed');
  }

  // Phase 3: finalise.
  const status = error ? 'failed' : 'succeeded';
  const final = await db.transaction(async (tx) => {
    const [updated] = await tx.update(migrationRuns).set({ status, counts, error, finishedAt: new Date() })
      .where(eq(migrationRuns.id, run.id)).returning();
    await recordEvent(tx, { workspaceId, type: error ? 'execution.failed' : 'execution.succeeded', actor: input.actor,
      subjectType: 'migration_run', subjectId: run.id, payload: { kind: run.kind, attempt: run.attempt, counts, error } });
    return updated;
  });
  return toDto(final);
}

export async function listRuns(workspaceId: string): Promise<MigrationRunDto[]> {
  await getWorkspace(workspaceId);
  const rows = await db.select().from(migrationRuns).where(eq(migrationRuns.workspaceId, workspaceId)).orderBy(desc(migrationRuns.startedAt), desc(migrationRuns.attempt));
  return Promise.all(rows.map(toDto));
}

export async function runIdsOf(rows: RunRow[]): Promise<string[]> {
  return rows.map((r) => r.id);
}
export { inArray as _inArray };
```

Drop the two trailing helper exports (`runIdsOf`, `_inArray`) if unused — they are not part of the interface.

Note: `logger` comes from Task 17 (`src/server/log.ts`). Create it now with this minimal content so the import resolves; Task 17 extends it:

`src/server/log.ts`:

```ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'migration-workbench' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ['*.apiKey', '*.GEMINI_API_KEY', 'req.headers.authorization'], remove: true },
});
```

`src/server/services/rollback.ts`:

```ts
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { migrationRuns, planVersions, rollbacks } from '../db/schema';
import { AppError } from '../errors';
import { recordEvent } from './audit';
import { activeRuns } from './executions';
import { deleteMigrated } from './target-store';
import { getWorkspace } from './workspaces';

export async function rollbackMigration(workspaceId: string, actor: string) {
  await getWorkspace(workspaceId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'ws:' + workspaceId}))`);
    const active = await activeRuns(tx, workspaceId);
    if (active.some((r) => r.status === 'running')) throw new AppError('RUN_IN_PROGRESS', 'Cannot roll back while a run is in progress');
    if (!active.length) throw new AppError('NOTHING_TO_ROLLBACK', 'There is no active migration to roll back');
    const runIds = active.map((r) => r.id);
    const rowsDeleted = await deleteMigrated(tx, workspaceId, runIds);
    await tx.update(migrationRuns).set({ status: 'rolled_back' }).where(inArray(migrationRuns.id, runIds));
    const [v] = await tx.select({ version: planVersions.version }).from(planVersions).where(eq(planVersions.id, active[0].planVersionId));
    const [row] = await tx.insert(rollbacks).values({ workspaceId, planVersionId: active[0].planVersionId, runIds, rowsDeleted }).returning();
    await recordEvent(tx, { workspaceId, type: 'rollback.completed', actor, subjectType: 'rollback', subjectId: row.id,
      payload: { rowsDeleted, runIds, version: v?.version } });
    return { id: row.id, rowsDeleted, runIds, version: v?.version ?? 0 };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project integration tests/integration/executions.test.ts`
Expected: PASS. For the concurrency test: the second call blocks on the advisory lock until the first transaction (phase 1) commits, then sees the `running` row and throws `RUN_IN_PROGRESS`; if the first run already finished, the second becomes a no-op retry. Both outcomes keep the invariant asserted.

- [ ] **Step 5: Commit**

```bash
git add src/server tests/integration && git commit -m "feat(services): approved, batched, idempotent execution with failure simulation and rollback"
```

---

### Task 13: Reconciliation service and history

**Files:**
- Create: `src/server/services/reconciliations.ts`
- Test: `tests/integration/reconcile.test.ts`

**Interfaces:**
- Consumes: `reconcile` (Task 6), `activeRuns`, `computeReport`, target store, `SEED_PREEXISTING_TARGET`
- Produces:
  - `runReconciliation(workspaceId, actor): Promise<ReconciliationDto>`
  - `listReconciliations(workspaceId): Promise<ReconciliationDto[]>`
  - `interface ReconciliationDto { id: string; version: number | null; result: 'pass' | 'fail'; details: ReconcileResult; createdAt: string }`

- [ ] **Step 1: Write failing tests** — `tests/integration/reconcile.test.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '@/server/db/client';
import { targetCustomers } from '@/server/db/schema';
import { executeMigration } from '@/server/services/executions';
import { listReconciliations, runReconciliation } from '@/server/services/reconciliations';
import { rollbackMigration } from '@/server/services/rollback';
import { approvedWorkspace, resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('runReconciliation', () => {
  it('passes after a complete migration', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    const r = await runReconciliation(ws, 'u');
    expect(r).toMatchObject({ version: 1, result: 'pass' });
    expect(r.details.checks.find((c) => c.id === 'row_count')).toMatchObject({ expected: 177, actual: 177 });
  });

  it('fails after a partial run and passes after retry', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u', failAfterBatches: 1 });
    const partial = await runReconciliation(ws, 'u');
    expect(partial.result).toBe('fail');
    expect(partial.details.missing).toHaveLength(127);
    await executeMigration(ws, { actor: 'u' });
    expect((await runReconciliation(ws, 'u')).result).toBe('pass');
  });

  it('detects a tampered target row', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    await db.execute(sql`update target.customers set lifetime_value_cents = lifetime_value_cents + 1
      where _workspace_id = ${ws} and legacy_id = 'C-00001'`);
    const r = await runReconciliation(ws, 'u');
    expect(r.result).toBe('fail');
    expect(r.details.mismatched.map((m) => m.legacyId)).toEqual(['C-00001']);
  });

  it('passes with a clean target after rollback and keeps history', async () => {
    const ws = await approvedWorkspace();
    await executeMigration(ws, { actor: 'u' });
    await rollbackMigration(ws, 'u');
    const r = await runReconciliation(ws, 'u');
    expect(r).toMatchObject({ result: 'pass', version: null });
    expect(r.details.activeMigration).toBe(false);
    const left = await db.select().from(targetCustomers).where(and(eq(targetCustomers.workspaceId, ws), eq(targetCustomers.origin, 'migrated')));
    expect(left).toHaveLength(0);
    expect(await listReconciliations(ws)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project integration tests/integration/reconcile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — `src/server/services/reconciliations.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import { reconcile, type ReconcileResult } from '@/domain/reconcile';
import { SEED_PREEXISTING_TARGET } from '@/seed';
import { db } from '../db/client';
import { planVersions, reconciliations } from '../db/schema';
import { recordEvent } from './audit';
import { computeReport } from './dry-runs';
import { activeRuns } from './executions';
import { getVersionById } from './plans';
import { allMigratedRows, preexistingRows } from './target-store';
import { getWorkspace } from './workspaces';

export interface ReconciliationDto { id: string; version: number | null; result: 'pass' | 'fail'; details: ReconcileResult; createdAt: string }

export async function runReconciliation(workspaceId: string, actor: string): Promise<ReconciliationDto> {
  const ws = await getWorkspace(workspaceId);
  return db.transaction(async (tx) => {
    const active = await activeRuns(tx, workspaceId);
    const version = active.length ? await getVersionById(tx, active[0].planVersionId) : null;
    const report = version ? (await computeReport(tx, workspaceId, version)).report : null;
    // All migrated rows count: rows from rolled-back runs should not exist, so any are "unexpected".
    const migrated = (await allMigratedRows(tx, workspaceId)).map(({ legacyId, row }) => ({ legacyId, row }));
    const details = reconcile({
      sourceCount: ws.sourceCount, report, migrated,
      preexistingExpected: SEED_PREEXISTING_TARGET, preexistingActual: await preexistingRows(tx, workspaceId),
    });
    const [row] = await tx.insert(reconciliations).values({
      workspaceId, planVersionId: version?.id ?? null, result: details.result, details }).returning();
    await recordEvent(tx, { workspaceId, type: 'reconciliation.completed', actor, subjectType: 'reconciliation', subjectId: row.id,
      payload: { result: details.result, version: version?.version ?? null,
        failedChecks: details.checks.filter((c) => !c.passed).map((c) => c.id) } });
    return { id: row.id, version: version?.version ?? null, result: details.result, details, createdAt: row.createdAt.toISOString() };
  });
}

export async function listReconciliations(workspaceId: string): Promise<ReconciliationDto[]> {
  await getWorkspace(workspaceId);
  const rows = await db.select({ r: reconciliations, version: planVersions.version }).from(reconciliations)
    .leftJoin(planVersions, eq(planVersions.id, reconciliations.planVersionId))
    .where(eq(reconciliations.workspaceId, workspaceId)).orderBy(desc(reconciliations.createdAt));
  return rows.map(({ r, version }) => ({ id: r.id, version: version ?? null, result: r.result,
    details: r.details as ReconcileResult, createdAt: r.createdAt.toISOString() }));
}
```

- [ ] **Step 4: Run all tests**

Run: `npm run test:unit && npm run test:int`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/reconciliations.ts tests/integration/reconcile.test.ts && git commit -m "feat(services): reconciliation with per-record hashes and history"
```

**Phase checkpoint:** update `AGENT_USAGE.md`; teaching note.
