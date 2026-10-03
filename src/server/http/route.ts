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

export const MAX_BODY_BYTES = 256 * 1024;

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const tooLarge = () => new AppError('LIMIT_EXCEEDED', `Request body exceeds ${MAX_BODY_BYTES / 1024} KB`);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw tooLarge();
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw tooLarge();
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
    const incoming = req.headers.get('x-request-id');
    const requestId = incoming && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID();
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
