import { NextResponse } from 'next/server';
import { db } from '@/server/db/client';
import { parseBody, withRoute } from '@/server/http/route';
import { createPlanBody } from '@/server/http/schemas';
import { createVersion, getVersion, listVersions } from '@/server/services/plans';
import { getWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';

export const GET = withRoute<{ ws: string }>(async ({ params }) => listVersions(params.ws));

export const POST = withRoute<{ ws: string }>(async ({ req, params, actor }) => {
  await getWorkspace(params.ws);
  const body = await parseBody(req, createPlanBody);
  const parent = body.baseVersion ? await getVersion(params.ws, body.baseVersion) : null;
  const version = await createVersion(db, { workspaceId: params.ws, content: body.content, author: 'user',
    parentVersionId: parent?.id ?? null, changeNote: body.changeNote ?? null, actor });
  return NextResponse.json(version, { status: 201 });
});
