import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
}
