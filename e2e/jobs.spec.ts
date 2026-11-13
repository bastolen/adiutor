/**
 * @file End-to-end tests for the Jobs page (Logs → Jobs): staff Admins and
 * Managers see the scheduled jobs with their schedule in words, the kinds of
 * queued job and the runs a tick made; staff Admins also run a job now,
 * pause and resume it (in the audit log), and retry or discard failed queued
 * jobs, which Managers can't. When the ticks stop, the dashboard and the Jobs
 * page warn. Support staff get the 404 page (`not-found.spec.ts`).
 */
import { type Page } from '@playwright/test';

import expectAccessible from './support/axe';
import {
  discardFailedQueuedJobs,
  makeTickLate,
  resumeJob,
  storeFailedQueuedJob,
} from './support/db';
import { PLATFORM_ADMIN, STEP_UP_MANAGER } from './support/fixtures';
import { adminStorageState, signIn, type StorageState, toasts } from './support/helpers';
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

test('a Manager sees the jobs too, without the controls', async ({ page }) => {
  await runJobs();
  await signIn(page, STEP_UP_MANAGER);

  await page.goto('/admin/logs/jobs');
  await expectJobs(page);
  await expect(page.getByRole('button', { name: /^(Run|Pause|Resume|Retry|Discard)/ })).toHaveCount(
    0,
  );
});

test.describe('as a staff Admin', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies(adminState.cookies);
  });

  test('runs a job now, and the run names who started it', async ({ page }) => {
    await page.goto('/admin/logs/jobs');
    await page.getByRole('button', { name: 'Run now: finished-sign-ins-as-users' }).click();

    await expect(toasts(page).getByText('finished-sign-ins-as-users ran.')).toBeVisible();
    const runs = page.getByRole('table', { name: /^Runs of background jobs/ });
    // A tick may run it as well meanwhile, so look for the run the Admin started.
    await expect(
      runs
        .getByRole('row')
        .filter({ hasText: 'finished-sign-ins-as-users' })
        .filter({ hasText: `From the Jobs page, by ${PLATFORM_ADMIN.name}` })
        .first(),
    ).toBeVisible();
  });

  test('pauses and resumes a job, which the audit log records', async ({ page }) => {
    // A retry after a failure halfway starts from a running job.
    await resumeJob('expired-sign-in-data');
    await page.goto('/admin/logs/jobs');
    const row = page
      .getByRole('table', { name: 'Scheduled jobs' })
      .getByRole('row')
      .filter({ hasText: 'expired-sign-in-data' });

    await page.getByRole('button', { name: 'Pause expired-sign-in-data' }).click();
    await expect(
      toasts(page).getByText('expired-sign-in-data is paused until it’s resumed.'),
    ).toBeVisible();
    await expect(row.getByText('Paused', { exact: true })).toBeVisible();
    // On narrow screens it's under the name instead, hidden here.
    await expect(row.getByText('Not while paused').filter({ visible: true })).toBeVisible();

    await page.getByRole('button', { name: 'Resume expired-sign-in-data' }).click();
    await expect(toasts(page).getByText('expired-sign-in-data is resumed.')).toBeVisible();
    await expect(row.getByText('Paused', { exact: true })).toHaveCount(0);

    await page.goto('/admin/logs?group=jobs');
    const audit = page.getByRole('table', { name: /^Audit log/ });
    await expect(audit.getByText('Paused a background job').first()).toBeVisible();
    await expect(audit.getByText('Resumed a background job').first()).toBeVisible();
    await expect(audit.getByText('Job expired-sign-in-data').first()).toBeVisible();
  });

  test('retries one failed queued job, and discards the rest of its kind after confirming', async ({
    page,
  }) => {
    // A retry after a failure halfway starts without the jobs that attempt left behind.
    await discardFailedQueuedJobs('staff-admin-added');
    await storeFailedQueuedJob(STEP_UP_MANAGER.email);
    await storeFailedQueuedJob(STEP_UP_MANAGER.email);
    await page.goto('/admin/logs/jobs');
    const failed = page.getByRole('table', { name: /^Failed queued jobs/ });
    await expect(failed.getByRole('row').filter({ hasText: 'staff-admin-added' })).toHaveCount(2);

    await failed
      .getByRole('button', { name: /^Retry the staff-admin-added job given up/ })
      .first()
      .click();
    await expect(
      toasts(page).getByText('1 job is back in the queue for the next tick.'),
    ).toBeVisible();
    await expect(failed.getByRole('row').filter({ hasText: 'staff-admin-added' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Discard failed staff-admin-added jobs' }).click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Discard every failed staff-admin-added job?',
    });
    await expect(dialog.getByText('1 job won’t run again.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard jobs' }).click();
    await expect(toasts(page).getByText('1 job discarded.')).toBeVisible();
    await expect(page.getByText('No failed jobs')).toBeVisible();
  });
});

test('staff are warned on the dashboard and the Jobs page when the ticks stop', async ({
  context,
  page,
}) => {
  await context.addCookies(adminState.cookies);
  const warning = page.getByRole('region', { name: 'Background jobs' });

  // Other tests tick all the time, which ends the warning: make the tick late again until it shows.
  await expect(async () => {
    await makeTickLate();
    await page.goto('/dashboard');
    await expect(warning.getByText("Background jobs aren't running")).toBeVisible({
      timeout: 2000,
    });
    await expect(warning).toContainText(/The last tick started 2 hours ago/);
    await expectAccessible(page);

    await warning.getByRole('link', { name: 'Open Jobs' }).click();
    await expect(page).toHaveURL('/admin/logs/jobs');
    await expect(warning).toBeVisible({ timeout: 2000 });
    await expectAccessible(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(warning).toBeVisible({ timeout: 2000 });
    await expectAccessible(page);
    await page.emulateMedia({ colorScheme: 'light' });
  }).toPass({ timeout: 60_000 });

  // The next tick ends it.
  await runJobs();
  await page.goto('/admin/logs/jobs');
  await expect(page.getByText(/^Last tick (just now|\d+ seconds? ago)$/)).toBeVisible();
  await expect(warning).toHaveCount(0);
});
