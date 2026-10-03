import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npx next start -p 3100',
    url: 'http://localhost:3100/api/health',
    timeout: 240_000,
    reuseExistingServer: true,
    env: { LLM_PROVIDER: 'mock', DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://workbench:workbench@localhost:5433/workbench' },
  },
});
