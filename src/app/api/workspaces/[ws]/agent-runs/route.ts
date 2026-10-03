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
