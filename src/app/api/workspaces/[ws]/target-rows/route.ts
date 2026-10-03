import { parseQuery, withRoute } from '@/server/http/route';
import { pageQuery } from '@/server/http/schemas';
import { listTargetRows } from '@/server/services/target-store';
import { getWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  await getWorkspace(params.ws);
  const { page, pageSize } = parseQuery(req, pageQuery);
  return listTargetRows(params.ws, page, pageSize);
});
