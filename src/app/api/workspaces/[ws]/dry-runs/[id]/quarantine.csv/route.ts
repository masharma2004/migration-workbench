import { withRoute } from '@/server/http/route';
import { quarantineCsv } from '@/server/services/dry-runs';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; id: string }>(async ({ params }) =>
  new Response(await quarantineCsv(params.ws, params.id), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="quarantine-${params.id}.csv"` },
  }));
