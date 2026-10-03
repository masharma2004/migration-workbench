import { withRoute } from '@/server/http/route';
import { getOverview } from '@/server/services/workspaces';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string }>(async ({ params }) => getOverview(params.ws));
