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
