import { parseQuery, withRoute } from '@/server/http/route';
import { historyQuery } from '@/server/http/schemas';
import { listEvents } from '@/server/services/audit';
import { getWorkspace } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  await getWorkspace(params.ws);
  return listEvents(params.ws, parseQuery(req, historyQuery));
});
