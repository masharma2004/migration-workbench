import { withRoute } from '@/server/http/route';
import { parseVersion } from '@/server/http/schemas';
import { getVersion } from '@/server/services/plans';

export const dynamic = 'force-dynamic';

export const GET = withRoute<{ ws: string; version: string }>(async ({ params }) => getVersion(params.ws, parseVersion(params.version)));
