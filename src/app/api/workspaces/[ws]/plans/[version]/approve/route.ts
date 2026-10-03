import { NextResponse } from 'next/server';
import { parseBody, withRoute } from '@/server/http/route';
import { approveBody } from '@/server/http/schemas';
import { approveVersion } from '@/server/services/approvals';
import { parseVersion } from '@/server/http/schemas';

export const dynamic = 'force-dynamic';
export const POST = withRoute<{ ws: string; version: string }>(async ({ req, params }) => {
  const body = await parseBody(req, approveBody);
  return NextResponse.json(await approveVersion(params.ws, parseVersion(params.version), body), { status: 201 });
});
