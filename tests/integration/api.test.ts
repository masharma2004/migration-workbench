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

describe('minor hardening', () => {
  it('returns 404, not 500, for malformed run and dry-run ids (review #6)', async () => {
    const { GET: getRun } = await import('@/app/api/workspaces/[ws]/agent-runs/[runId]/route');
    const { GET: getDry } = await import('@/app/api/workspaces/[ws]/dry-runs/[id]/route');
    const { id } = await (await createWs(req('/api/workspaces', { method: 'POST' }), p({}))).json();
    expect((await getRun(req(`/api/workspaces/${id}/agent-runs/abc`), p({ ws: id, runId: 'abc' }))).status).toBe(404);
    expect((await getDry(req(`/api/workspaces/${id}/dry-runs/abc`), p({ ws: id, id: 'abc' }))).status).toBe(404);
  });
  it('ignores unsafe client request ids (review #11)', async () => {
    const bad = 'x'.repeat(300);
    const res = await health(new NextRequest('http://localhost/api/health', { headers: { 'x-request-id': bad } }), p({}));
    expect(res.headers.get('x-request-id')).not.toBe(bad);
  });
});

describe('workspace creation limits (review #3)', () => {
  it('rate-limits workspace creation per client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await createWs(req('/api/workspaces', { method: 'POST' }), p({}))).status);
    expect(statuses).toContain(429);
  });
});
