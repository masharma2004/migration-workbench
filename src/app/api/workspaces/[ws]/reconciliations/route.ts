import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route';
import { listReconciliations, runReconciliation } from '@/server/services/reconciliations';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ params }) => listReconciliations(params.ws));
export const POST = withRoute<{ ws: string }>(async ({ params, actor }) => NextResponse.json(await runReconciliation(params.ws, actor), { status: 201 }));
