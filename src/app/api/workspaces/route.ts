import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http/route';
import { createWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async ({ log }) => {
  const ws = await createWorkspace();
  log.info({ workspaceId: ws.id }, 'workspace created');
  return NextResponse.json(ws, { status: 201 });
});
