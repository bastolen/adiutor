/**
 * @file End-to-end tests for the Jobs page (Logs → Jobs): staff Admins and
 * Managers see the scheduled jobs with their schedule in words, the kinds of
 * queued job and the runs a tick made. Support staff get the 404 page
 * (`not-found.spec.ts`).
 */
import { type Page } from '@playwright/test';

import { STEP_UP_MANAGER } from './support/fixtures';
import { adminStorageState, signIn, type StorageState } from './support/helpers';
import { runJobs } from './support/outbox';
import { expect, test } from './support/test';

/** Sign-in cookies of the staff Admin. */
let adminState: StorageState;

test.beforeAll(async ({ browser }) => {
  adminState = await adminStorageState(browser);
});

/**
 * Checks the Jobs page shows the jobs and the runs of the tick.
 *
 * @param page - The browser page, on the Jobs page.
 */
async function expectJobs(page: Page) {
  const scheduled = page.getByRole('table', { name: 'Scheduled jobs' });
  await expect(scheduled.getByText('retention', { exact: true })).toBeVisible();
  await expect(scheduled.getByText(/^Deletes audit events after a year/)).toBeVisible();
  await expect(scheduled.getByText(/^Every day at 3:15\sAM UTC$/)).toBeVisible();
  await expect(scheduled.getByText('Every 5 minutes').first()).toBeVisible();

  const queued = page.getByRole('table', { name: 'Kinds of queued job' });
  await expect(queued.getByText('security-notice', { exact: true })).toBeVisible();

  const runs = page.getByRole('table', { name: /^Runs of background jobs/ });
  await expect(runs.getByText('By the tick').first()).toBeVisible();
}

test('a staff Admin finds the jobs under Logs, with the runs of the tick', async ({
  context,
  page,
}) => {
  await context.addCookies(adminState.cookies);
  await runJobs();

  await page.goto('/admin/logs');
  await page
    .getByRole('navigation', { name: 'Log sections' })
    .getByRole('link', { name: 'Jobs' })
    .click();
  await expect(page).toHaveURL('/admin/logs/jobs');
  await expect(page).toHaveTitle('Jobs · Adiutor');
  await expectJobs(page);
});

test('a Manager sees the jobs too', async ({ page }) => {
  await runJobs();
  await signIn(page, STEP_UP_MANAGER);

  await page.goto('/admin/logs/jobs');
  await expectJobs(page);
});
