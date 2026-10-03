import { describeRules } from '@/domain/rules';
import { withRoute } from '@/server/http/route';

export const dynamic = 'force-dynamic';
export const GET = withRoute(async () => describeRules());
