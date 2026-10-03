import { getActorName } from './actor';

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: unknown, readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-actor-name': getActorName() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the server. Check your connection and try again.', 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const e = (json as { error?: { code: string; message: string; details?: unknown; requestId?: string } } | null)?.error;
    throw new ApiError(e?.code ?? 'INTERNAL', e?.message ?? `Request failed (HTTP ${res.status})`, res.status, e?.details, e?.requestId);
  }
  return json as T;
}
