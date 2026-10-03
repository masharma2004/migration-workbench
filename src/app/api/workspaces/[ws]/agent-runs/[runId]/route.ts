import { withRoute } from '@/server/http/route';
import { getAgentRun } from '@/server/services/agent-runs';

export const dynamic = 'force-dynamic';
export const GET = withRoute<{ ws: string; runId: string }>(async ({ params }) => getAgentRun(params.ws, params.runId));
