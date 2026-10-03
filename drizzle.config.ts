import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['app', 'target'],
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://workbench:workbench@localhost:5433/workbench' },
});
