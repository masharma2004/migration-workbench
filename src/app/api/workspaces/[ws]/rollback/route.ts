import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route';
import { rollbackMigration } from '@/server/services/rollback';

export const dynamic = 'force-dynamic';
export const POST = withRoute<{ ws: string }>(async ({ params, actor }) => NextResponse.json(await rollbackMigration(params.ws, actor), { status: 201 }));
