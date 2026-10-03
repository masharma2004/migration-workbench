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
