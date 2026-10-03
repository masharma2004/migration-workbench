import { parseQuery, withRoute } from '@/server/http/route';
import { pageQuery } from '@/server/http/schemas';
import { listSourceRecords } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  const { page, pageSize } = parseQuery(req, pageQuery);
  return listSourceRecords(params.ws, page, pageSize);
});
