import { parseQuery, withRoute } from '@/server/http/route';
import { quarantineQuery } from '@/server/http/schemas';
import { getDryRun, listQuarantine } from '@/server/services/dry-runs';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; id: string }>(async ({ req, params }) => {
  const filter = parseQuery(req, quarantineQuery);
  const [dryRun, quarantine] = await Promise.all([getDryRun(params.ws, params.id), listQuarantine(params.ws, params.id, filter)]);
  return { ...dryRun, quarantine };
});
