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
  it('rejects oversized bodies with 413 LIMIT_EXCEEDED (review #4)', async () => {
    const res = await call(JSON.stringify({ n: 1, pad: 'x'.repeat(300_000) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('LIMIT_EXCEEDED');
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
