import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { withRoute } from '@/server/http/route';

export const dynamic = 'force-dynamic';

export const GET = withRoute(async () => {
  let dbStatus = 'ok';
  try { await db.execute(sql`select 1`); } catch { dbStatus = 'error'; }
  return { status: dbStatus === 'ok' ? 'ok' : 'degraded', db: dbStatus, agent: process.env.GEMINI_API_KEY || process.env.LLM_PROVIDER === 'mock' ? 'configured' : 'not_configured',
    version: process.env.APP_VERSION ?? 'dev' };
});
