# Phase 5 — HTTP API (Tasks 17–18)

Read `00-index.md` first.

---

### Task 17: HTTP infrastructure — withRoute, error mapping, body parsing, rate limiting, logging

**Files:**
- Modify: `src/server/log.ts` (already created in Task 12; unchanged unless noted)
- Create: `src/server/http/route.ts`, `src/server/http/rate-limit.ts`
- Test: `tests/unit/http/route.test.ts`, `tests/unit/http/rate-limit.test.ts`

**Interfaces:**
- Consumes: `AppError`, `LimitExceededError`, `InvalidPlanError`, `logger`
- Produces:
  - `toErrorBody(err: unknown, requestId: string): { status: number; body: { error: { code: string; message: string; details?: unknown; requestId: string } } }`
  - `withRoute<P>(handler: (a: { req: NextRequest; params: P; log: Logger; requestId: string; ip: string; actor: string }) => Promise<unknown>)` → Next route handler `(req, ctx: { params: Promise<P> }) => Promise<Response>`
  - `parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T>`, `parseQuery<T>(req: NextRequest, schema: z.ZodType<T>): T`
  - `class RateLimiter { constructor(perWindow: number, windowMs: number, dailyCap: number, now?: () => number); check(key: string): { ok: true } | { ok: false; retryAfterSec: number; reason: string } }`, `agentLimiter`

- [ ] **Step 1: Write failing tests**

`tests/unit/http/route.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InvalidPlanError } from '@/domain/engine';
import { LimitExceededError } from '@/domain/types';
import { AppError } from '@/server/errors';
import { parseBody, toErrorBody, withRoute } from '@/server/http/route';

describe('toErrorBody', () => {
  it('maps known errors to codes and statuses', () => {
    expect(toErrorBody(new AppError('NOT_APPROVED', 'x'), 'r1')).toMatchObject({ status: 409, body: { error: { code: 'NOT_APPROVED', requestId: 'r1' } } });
    expect(toErrorBody(new LimitExceededError('too many'), 'r')).toMatchObject({ status: 413, body: { error: { code: 'LIMIT_EXCEEDED' } } });
    expect(toErrorBody(new InvalidPlanError([]), 'r')).toMatchObject({ status: 409, body: { error: { code: 'NOT_READY' } } });
  });
  it('hides internals of unexpected errors', () => {
    const r = toErrorBody(new Error('password=hunter2'), 'r');
    expect(r).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL', message: 'Unexpected server error' } } });
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
});

describe('withRoute', () => {
  const handler = withRoute<{ id: string }>(async ({ req, params }) => {
    const body = await parseBody(req, z.object({ n: z.number().int() }));
    return { id: params.id, n: body.n };
  });
  const call = (body: string) => handler(new NextRequest('http://x/api/t', { method: 'POST', body, headers: { 'x-request-id': 'req-1' } }),
    { params: Promise.resolve({ id: 'a' }) });

  it('returns JSON and echoes the request id', async () => {
    const res = await call('{"n":1}');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('req-1');
    expect(await res.json()).toEqual({ id: 'a', n: 1 });
  });
  it('returns 400 VALIDATION_ERROR for invalid JSON and schema failures', async () => {
    const bad = await call('{not json');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION_ERROR');
    const wrong = await call('{"n":"x"}');
    const body = await wrong.json();
    expect(body.error.details[0]).toMatchObject({ path: 'n' });
  });
});
```

`tests/unit/http/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@/server/http/rate-limit';

describe('RateLimiter', () => {
  it('limits per key within a sliding window', () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, 100, () => now);
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('a').ok).toBe(true);
    const third = rl.check('a');
    expect(third.ok).toBe(false);
    expect(rl.check('b').ok).toBe(true);
    now = 1001;
    expect(rl.check('a').ok).toBe(true);
  });
  it('enforces a global daily cap that resets each UTC day', () => {
    let now = Date.UTC(2026, 9, 2, 23, 0);
    const rl = new RateLimiter(100, 1000, 2, () => now);
    rl.check('a'); rl.check('b');
    expect(rl.check('c')).toMatchObject({ ok: false, reason: expect.stringMatching(/daily/) });
    now = Date.UTC(2026, 9, 3, 0, 1);
    expect(rl.check('c').ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/http`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/server/http/route.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { InvalidPlanError } from '@/domain/engine';
import { LimitExceededError } from '@/domain/types';
import { AppError } from '../errors';
import { logger } from '../log';

export function toErrorBody(err: unknown, requestId: string) {
  let code = 'INTERNAL', status = 500, message = 'Unexpected server error';
  let details: unknown;
  if (err instanceof AppError) ({ code, status, message, details } = err);
  else if (err instanceof LimitExceededError) { code = 'LIMIT_EXCEEDED'; status = 413; message = err.message; }
  else if (err instanceof InvalidPlanError) { code = 'NOT_READY'; status = 409; message = err.message; details = err.issues; }
  return { status, body: { error: { code, message, ...(details !== undefined ? { details } : {}), requestId } } };
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await req.text();
  let json: unknown = {};
  if (text.trim()) {
    try { json = JSON.parse(text); } catch { throw new AppError('VALIDATION_ERROR', 'Request body is not valid JSON'); }
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Request body is invalid',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return parsed.data;
}

export function parseQuery<T>(req: NextRequest, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Query parameters are invalid',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return parsed.data;
}

const clientIp = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
const actorOf = (req: NextRequest) => (req.headers.get('x-actor-name') ?? '').trim().slice(0, 60) || 'anonymous';

type Handler<P> = (a: { req: NextRequest; params: P; log: Logger; requestId: string; ip: string; actor: string }) => Promise<unknown>;

export function withRoute<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const requestId = req.headers.get('x-request-id') || randomUUID();
    const started = performance.now();
    const params = ((await ctx?.params) ?? {}) as P;
    const log = logger.child({ component: 'http', requestId, method: req.method, path: req.nextUrl.pathname,
      workspaceId: (params as Record<string, string>).ws });
    try {
      const out = await handler({ req, params, log, requestId, ip: clientIp(req), actor: actorOf(req) });
      const res = out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
      res.headers.set('x-request-id', requestId);
      log.info({ status: res.status, durationMs: Math.round(performance.now() - started) }, 'request');
      return res;
    } catch (err) {
      const { status, body } = toErrorBody(err, requestId);
      const entry = { status, code: body.error.code, durationMs: Math.round(performance.now() - started) };
      if (status >= 500) log.error({ ...entry, err }, 'request failed');
      else log.warn(entry, 'request rejected');
      return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
    }
  };
}
```

`src/server/http/rate-limit.ts`:

```ts
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private day = '';
  private dayCount = 0;

  constructor(private readonly perWindow: number, private readonly windowMs: number, private readonly dailyCap: number,
    private readonly now: () => number = Date.now) {}

  check(key: string): { ok: true } | { ok: false; retryAfterSec: number; reason: string } {
    const t = this.now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.dayCount = 0; }
    if (this.dayCount >= this.dailyCap) {
      return { ok: false, retryAfterSec: 3600, reason: `The daily agent run limit (${this.dailyCap}) has been reached` };
    }
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.perWindow) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.ceil((this.windowMs - (t - recent[0])) / 1000),
        reason: `At most ${this.perWindow} agent runs per ${Math.round(this.windowMs / 60000)} minutes` };
    }
    recent.push(t);
    this.hits.set(key, recent);
    this.dayCount += 1;
    return { ok: true };
  }
}

export const agentLimiter = new RateLimiter(
  Number(process.env.AGENT_RATE_PER_10MIN ?? 6), 10 * 60_000, Number(process.env.AGENT_DAILY_CAP ?? 300));
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project unit tests/unit/http`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/http tests/unit/http && git commit -m "feat(http): route wrapper with request ids, error mapping, validation, rate limiter"
```

---

### Task 18: Route handlers

**Files** (all under `src/app/api/`):
- `health/route.ts`
- `workspaces/route.ts`
- `workspaces/[ws]/route.ts`
- `workspaces/[ws]/source-records/route.ts`
- `workspaces/[ws]/target-rows/route.ts`
- `workspaces/[ws]/plans/route.ts`
- `workspaces/[ws]/plans/diff/route.ts`
- `workspaces/[ws]/plans/[version]/route.ts`
- `workspaces/[ws]/plans/[version]/dry-run/route.ts`
- `workspaces/[ws]/plans/[version]/readiness/route.ts`
- `workspaces/[ws]/plans/[version]/approve/route.ts`
- `workspaces/[ws]/agent-runs/route.ts`
- `workspaces/[ws]/agent-runs/[runId]/route.ts`
- `workspaces/[ws]/dry-runs/[id]/route.ts`
- `workspaces/[ws]/dry-runs/[id]/quarantine.csv/route.ts`
- `workspaces/[ws]/executions/route.ts`
- `workspaces/[ws]/rollback/route.ts`
- `workspaces/[ws]/reconciliations/route.ts`
- `workspaces/[ws]/history/route.ts`
- Create: `src/server/http/schemas.ts` (shared query/body schemas)
- Test: `tests/integration/api.test.ts`

**Interfaces:**
- Consumes: all services, `withRoute`, `parseBody`, `parseQuery`, `agentLimiter`
- Produces: the REST API in spec §10. Every handler file exports `export const dynamic = 'force-dynamic';` and named method handlers.

- [ ] **Step 1: Write the failing API test** — `tests/integration/api.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as health } from '@/app/api/health/route';
import { POST as createWs } from '@/app/api/workspaces/route';
import { GET as overview } from '@/app/api/workspaces/[ws]/route';
import { POST as createPlan } from '@/app/api/workspaces/[ws]/plans/route';
import { POST as approve } from '@/app/api/workspaces/[ws]/plans/[version]/approve/route';
import { POST as execute } from '@/app/api/workspaces/[ws]/executions/route';
import { closeDb } from '@/server/db/client';
import { REFERENCE_PLAN } from '@/seed/reference-plan';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);
afterAll(closeDb);

const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: init.method ?? 'GET', headers: { 'x-actor-name': 'API Test' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const p = <T>(v: T) => ({ params: Promise.resolve(v) });

describe('API', () => {
  it('health reports ok with a DB check', async () => {
    const res = await health(req('/api/health'), p({}));
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('creates a workspace and serves its overview', async () => {
    const created = await (await createWs(req('/api/workspaces', { method: 'POST' }), p({}))).json();
    const res = await overview(req(`/api/workspaces/${created.id}`), p({ ws: created.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, sourceCount: 200 });
  });

  it('returns a structured 404 for unknown workspaces', async () => {
    const res = await overview(req('/api/workspaces/nope'), p({ ws: 'nope' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(body.error.requestId).toBeTruthy();
  });

  it('enforces the approval gate over HTTP', async () => {
    const { id } = await (await createWs(req('/api/workspaces', { method: 'POST' }), p({}))).json();
    const v = await createPlan(req(`/api/workspaces/${id}/plans`, { method: 'POST', body: { content: { plan: REFERENCE_PLAN }, changeNote: 'manual' } }), p({ ws: id }));
    expect(v.status).toBe(201);
    const notReady = await approve(req(`/api/workspaces/${id}/plans/1/approve`, { method: 'POST', body: { approvedBy: 'R', acknowledgeDryRun: true } }), p({ ws: id, version: '1' }));
    expect(notReady.status).toBe(409);
    expect((await notReady.json()).error.code).toBe('NOT_READY');
    const exec = await execute(req(`/api/workspaces/${id}/executions`, { method: 'POST', body: {} }), p({ ws: id }));
    expect((await exec.json()).error.code).toBe('NOT_APPROVED');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project integration tests/integration/api.test.ts`
Expected: FAIL — route modules missing.

- [ ] **Step 3: Shared schemas** — `src/server/http/schemas.ts`:

```ts
import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const versionParam = z.coerce.number().int().min(1);
export const createPlanBody = z.object({
  baseVersion: z.number().int().min(1).optional(),
  content: z.unknown(),
  changeNote: z.string().max(500).optional(),
});
export const approveBody = z.object({
  approvedBy: z.string().max(100),
  note: z.string().max(1000).optional(),
  acknowledgeDryRun: z.boolean(),
});
export const agentRunBody = z.object({
  mode: z.enum(['propose', 'revise']),
  baseVersion: z.number().int().min(1).optional(),
  answers: z.record(z.string(), z.string().max(2000)).optional(),
  instructions: z.string().max(2000).optional(),
});
export const executeBody = z.object({ failAfterBatches: z.number().int().min(0).max(20).nullable().optional() });
export const quarantineQuery = z.object({ stage: z.string().optional(), code: z.string().optional(), field: z.string().optional() });
export const diffQuery = z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) });
export const historyQuery = z.object({ type: z.string().optional() });

export function parseVersion(raw: string): number {
  const v = versionParam.safeParse(raw);
  if (!v.success) throw new AppError('VALIDATION_ERROR', `Invalid plan version "${raw}"`);
  return v.data;
}
```

Add `import { AppError } from '../errors';` at the top of `schemas.ts`.

- [ ] **Step 4: Route handlers** — create each file exactly as below.

`src/app/api/health/route.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { withRoute } from '@/server/http/route';

export const dynamic = 'force-dynamic';

export const GET = withRoute(async () => {
  let dbStatus = 'ok';
  try { await db.execute(sql`select 1`); } catch { dbStatus = 'error'; }
  return { status: dbStatus === 'ok' ? 'ok' : 'degraded', db: dbStatus, agent: process.env.GEMINI_API_KEY || process.env.LLM_PROVIDER === 'mock' ? 'configured' : 'not_configured',
    version: process.env.APP_VERSION ?? 'dev' };
});
```

`src/app/api/workspaces/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route';
import { createWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async ({ log }) => {
  const ws = await createWorkspace();
  log.info({ workspaceId: ws.id }, 'workspace created');
  return NextResponse.json(ws, { status: 201 });
});
```

`src/app/api/workspaces/[ws]/route.ts`:

```ts
import { withRoute } from '@/server/http/route';
import { getOverview } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ params }) => getOverview(params.ws));
```

`src/app/api/workspaces/[ws]/source-records/route.ts`:

```ts
import { parseQuery, withRoute } from '@/server/http/route';
import { pageQuery } from '@/server/http/schemas';
import { listSourceRecords } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  const { page, pageSize } = parseQuery(req, pageQuery);
  return listSourceRecords(params.ws, page, pageSize);
});
```

`src/app/api/workspaces/[ws]/target-rows/route.ts`:

```ts
import { parseQuery, withRoute } from '@/server/http/route';
import { pageQuery } from '@/server/http/schemas';
import { listTargetRows } from '@/server/services/target-store';
import { getWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  await getWorkspace(params.ws);
  const { page, pageSize } = parseQuery(req, pageQuery);
  return listTargetRows(params.ws, page, pageSize);
});
```

`src/app/api/workspaces/[ws]/plans/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/server/db/client';
import { parseBody, withRoute } from '@/server/http/route';
import { createPlanBody } from '@/server/http/schemas';
import { createVersion, getVersion, listVersions } from '@/server/services/plans';
import { getWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';

export const GET = withRoute<{ ws: string }>(async ({ params }) => listVersions(params.ws));

export const POST = withRoute<{ ws: string }>(async ({ req, params, actor }) => {
  await getWorkspace(params.ws);
  const body = await parseBody(req, createPlanBody);
  const parent = body.baseVersion ? await getVersion(params.ws, body.baseVersion) : null;
  const version = await createVersion(db, { workspaceId: params.ws, content: body.content, author: 'user',
    parentVersionId: parent?.id ?? null, changeNote: body.changeNote ?? null, actor });
  return NextResponse.json(version, { status: 201 });
});
```

`src/app/api/workspaces/[ws]/plans/diff/route.ts`:

```ts
import { parseQuery, withRoute } from '@/server/http/route';
import { diffQuery } from '@/server/http/schemas';
import { diffVersions } from '@/server/services/plans';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  const { from, to } = parseQuery(req, diffQuery);
  return diffVersions(params.ws, from, to);
});
```

`src/app/api/workspaces/[ws]/plans/[version]/route.ts`:

```ts
import { withRoute } from '@/server/http/route';
import { parseVersion } from '@/server/http/schemas';
import { getVersion } from '@/server/services/plans';

export const dynamic = 'force-dynamic';

export const GET = withRoute<{ ws: string; version: string }>(async ({ params }) => getVersion(params.ws, parseVersion(params.version)));
```

`src/app/api/workspaces/[ws]/plans/[version]/dry-run/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route';
import { runDryRun } from '@/server/services/dry-runs';
import { parseVersion } from '@/server/http/schemas';

export const dynamic = 'force-dynamic';
export const POST = withRoute<{ ws: string; version: string }>(async ({ params, actor, log }) => {
  const result = await runDryRun(params.ws, parseVersion(params.version), actor);
  log.info({ component: 'engine', counts: result.counts, reportHash: result.reportHash }, 'dry run completed');
  return NextResponse.json(result, { status: 201 });
});
```

`src/app/api/workspaces/[ws]/plans/[version]/readiness/route.ts`:

```ts
import { withRoute } from '@/server/http/route';
import { getReadiness } from '@/server/services/approvals';
import { parseVersion } from '@/server/http/schemas';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; version: string }>(async ({ params }) => getReadiness(params.ws, parseVersion(params.version)));
```

`src/app/api/workspaces/[ws]/plans/[version]/approve/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { parseBody, withRoute } from '@/server/http/route';
import { approveBody } from '@/server/http/schemas';
import { approveVersion } from '@/server/services/approvals';
import { parseVersion } from '@/server/http/schemas';

export const dynamic = 'force-dynamic';
export const POST = withRoute<{ ws: string; version: string }>(async ({ req, params }) => {
  const body = await parseBody(req, approveBody);
  return NextResponse.json(await approveVersion(params.ws, parseVersion(params.version), body), { status: 201 });
});
```

`src/app/api/workspaces/[ws]/agent-runs/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { AppError } from '@/server/errors';
import { agentLimiter } from '@/server/http/rate-limit';
import { parseBody, withRoute } from '@/server/http/route';
import { agentRunBody } from '@/server/http/schemas';
import { listAgentRuns, startAgentRun } from '@/server/services/agent-runs';

export const dynamic = 'force-dynamic';

export const GET = withRoute<{ ws: string }>(async ({ params }) => listAgentRuns(params.ws));

export const POST = withRoute<{ ws: string }>(async ({ req, params, ip, actor }) => {
  const body = await parseBody(req, agentRunBody);
  const limit = agentLimiter.check(ip);
  if (!limit.ok) throw new AppError('RATE_LIMITED', `${limit.reason}. Try again in ${limit.retryAfterSec}s.`, { retryAfterSec: limit.retryAfterSec });
  return NextResponse.json(await startAgentRun(params.ws, body, actor), { status: 202 });
});
```

`src/app/api/workspaces/[ws]/agent-runs/[runId]/route.ts`:

```ts
import { withRoute } from '@/server/http/route';
import { getAgentRun } from '@/server/services/agent-runs';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; runId: string }>(async ({ params }) => getAgentRun(params.ws, params.runId));
```

`src/app/api/workspaces/[ws]/dry-runs/[id]/route.ts`:

```ts
import { parseQuery, withRoute } from '@/server/http/route';
import { quarantineQuery } from '@/server/http/schemas';
import { getDryRun, listQuarantine } from '@/server/services/dry-runs';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; id: string }>(async ({ req, params }) => {
  const filter = parseQuery(req, quarantineQuery);
  const [dryRun, quarantine] = await Promise.all([getDryRun(params.ws, params.id), listQuarantine(params.ws, params.id, filter)]);
  return { ...dryRun, quarantine };
});
```

`src/app/api/workspaces/[ws]/dry-runs/[id]/quarantine.csv/route.ts`:

```ts
import { withRoute } from '@/server/http/route';
import { quarantineCsv } from '@/server/services/dry-runs';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; id: string }>(async ({ params }) =>
  new Response(await quarantineCsv(params.ws, params.id), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="quarantine-${params.id}.csv"` },
  }));
```

`src/app/api/workspaces/[ws]/executions/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { parseBody, withRoute } from '@/server/http/route';
import { executeBody } from '@/server/http/schemas';
import { executeMigration, listRuns } from '@/server/services/executions';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ params }) => listRuns(params.ws));
export const POST = withRoute<{ ws: string }>(async ({ req, params, actor }) => {
  const body = await parseBody(req, executeBody);
  return NextResponse.json(await executeMigration(params.ws, { failAfterBatches: body.failAfterBatches ?? null, actor }), { status: 201 });
});
```

`src/app/api/workspaces/[ws]/rollback/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route';
import { rollbackMigration } from '@/server/services/rollback';

export const dynamic = 'force-dynamic';
export const POST = withRoute<{ ws: string }>(async ({ params, actor }) => NextResponse.json(await rollbackMigration(params.ws, actor), { status: 201 }));
```

`src/app/api/workspaces/[ws]/reconciliations/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route';
import { listReconciliations, runReconciliation } from '@/server/services/reconciliations';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ params }) => listReconciliations(params.ws));
export const POST = withRoute<{ ws: string }>(async ({ params, actor }) => NextResponse.json(await runReconciliation(params.ws, actor), { status: 201 }));
```

`src/app/api/workspaces/[ws]/history/route.ts`:

```ts
import { parseQuery, withRoute } from '@/server/http/route';
import { historyQuery } from '@/server/http/schemas';
import { listEvents } from '@/server/services/audit';
import { getWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  await getWorkspace(params.ws);
  return listEvents(params.ws, parseQuery(req, historyQuery));
});
```

`parseVersion` lives in `schemas.ts` because Next.js rejects non-HTTP-method exports from `route.ts` files.

- [ ] **Step 5: Run tests and build**

Run: `npm run test:int && npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 6: Manual smoke with curl** (dev server: `npm run dev` with `.env` loaded)

```bash
WS=$(curl -s -X POST localhost:3000/api/workspaces | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s localhost:3000/api/workspaces/$WS | head -c 300; echo
curl -s -X POST localhost:3000/api/workspaces/$WS/executions -H 'content-type: application/json' -d '{}'; echo
```

Expected: overview JSON; then `{"error":{"code":"NOT_APPROVED",...}}`. The dev-server console shows JSON log lines with `requestId`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api src/server/http tests/integration/api.test.ts && git commit -m "feat(api): REST endpoints for workspaces, plans, agent, dry runs, execution, rollback, reconcile, history"
```

**Phase checkpoint:** update `AGENT_USAGE.md`; teaching note.
