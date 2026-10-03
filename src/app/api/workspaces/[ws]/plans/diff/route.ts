import { parseQuery, withRoute } from '@/server/http/route';
import { diffQuery } from '@/server/http/schemas';
import { diffVersions } from '@/server/services/plans';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ req, params }) => {
  const { from, to } = parseQuery(req, diffQuery);
  return diffVersions(params.ws, from, to);
});
