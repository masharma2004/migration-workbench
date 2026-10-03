import { expect, test } from '@playwright/test';

test('plan → approve → fail → retry → reconcile → rollback', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/Your name/).fill('E2E Reviewer');
  await page.getByRole('button', { name: /Start a new workspace/ }).click();
  await page.waitForURL(/\/w\/[\w-]+$/);

  await page.getByRole('link', { name: /Plan/ }).click();
  await page.getByRole('button', { name: /Propose with Gemini/ }).click();
  await expect(page.getByText(/Plan v1/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Month-first (US)' }).click();
  await page.getByRole('button', { name: 'Yes, default to false' }).click();
  await page.getByRole('button', { name: /Save answers as new version/ }).click();
  await expect(page.getByText(/Plan v2/)).toBeVisible();

  await page.getByRole('button', { name: /Dry run this version/ }).click();
  await page.waitForURL(/dry-run\?version=2/);
  await expect(page.getByText('177', { exact: true })).toBeVisible();

  await page.goto(page.url().replace(/dry-run\?version=2$/, 'execute?version=2'));
  await page.getByRole('checkbox', { name: /I reviewed the dry run/ }).check();
  await page.getByRole('button', { name: 'Approve v2' }).click();
  await expect(page.getByText(/currently approved/)).toBeVisible();

  await page.getByRole('checkbox', { name: /Simulate a failure/ }).check();
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.getByText('failed', { exact: true }).first()).toBeVisible();
  await page.getByRole('checkbox', { name: /Simulate a failure/ }).uncheck();
  await page.getByRole('button', { name: /Retry \/ resume/ }).click();
  await expect(page.getByText('succeeded').first()).toBeVisible();

  await page.getByRole('link', { name: /Reconcile/ }).click();
  await page.getByRole('button', { name: /Run reconciliation/ }).click();
  await expect(page.getByText('PASS', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Approve & execute/ }).click();
  await page.getByRole('button', { name: 'Roll back' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Roll back' }).click();
  await expect(page.getByText(/Rolled back: 177 rows removed/)).toBeVisible();
});
