import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';

export async function resetDatabase(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.allow_audit_delete = 'on'`);
    await tx.execute(sql`TRUNCATE app.workspaces, target.customers CASCADE`);
  });
}
