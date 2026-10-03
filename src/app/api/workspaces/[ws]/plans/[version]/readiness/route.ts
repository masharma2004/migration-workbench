import { withRoute } from '@/server/http/route';
import { getReadiness } from '@/server/services/approvals';
import { parseVersion } from '@/server/http/schemas';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; version: string }>(async ({ params }) => getReadiness(params.ws, parseVersion(params.version)));
