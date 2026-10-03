import postgres from 'postgres';

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST ?? 'postgres://workbench:workbench@localhost:5433/workbench_test';
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS target CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await sql.end();
  process.env.DATABASE_URL = url;
  const { runMigrations } = await import('../../src/server/db/migrate');
  const { closeDb } = await import('../../src/server/db/client');
  await runMigrations();
  await closeDb();
}
