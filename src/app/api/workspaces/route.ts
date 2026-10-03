import { NextResponse } from 'next/server';
import { AppError } from '@/server/errors';
import { workspaceLimiter } from '@/server/http/rate-limit';
import { withRoute } from '@/server/http/route';
import { createWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async ({ log, ip }) => {
  const limit = workspaceLimiter.check(ip);
  if (!limit.ok) throw new AppError('RATE_LIMITED', `${limit.reason}. Try again in ${limit.retryAfterSec}s.`, { retryAfterSec: limit.retryAfterSec });
  const ws = await createWorkspace();
  log.info({ workspaceId: ws.id }, 'workspace created');
  return NextResponse.json(ws, { status: 201 });
});
