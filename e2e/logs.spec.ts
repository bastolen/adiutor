/**
 * @file End-to-end tests for the Logs pages: staff Admins find events in the
 * audit log by search, group and days, and look up the reference an error
 * page showed (however it's typed); Managers see the audit log but not the
 * errors; Support staff see neither.
 */
import { type Page } from '@playwright/test';

import { PLATFORM_ADMIN, STEP_UP_MANAGER, SUPPORT_STAFF } from './support/fixtures';
import { adminStorageState, signIn, type StorageState } from './support/helpers';
import { expect, test } from './support/test';
import { defined } from '../src/lib/defined';

/** Sign-in cookies of the staff Admin. */
let adminState: StorageState;

test.beforeAll(async ({ browser }) => {
  adminState = await adminStorageState(browser);
});

/**
 * The audit log's table (named by its caption).
 *
 * @param page - The browser page.
 * @returns The table.
 */
function auditTable(page: Page) {
  return page.getByRole('table', { name: /^Audit log/ });
}

test.describe('as a staff Admin', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies(adminState.cookies);
  });

  test('the audit log narrows by search, group and days, keeping the other filters', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Logs', exact: true }).first().click();
    await expect(page).toHaveURL('/admin/logs');
    await expect(page.getByRole('heading', { level: 1, name: 'Logs' })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Log sections' })
        .getByRole('link', { name: 'Audit log' }),
    ).toHaveAttribute('aria-current', 'page');
    // The Admin's own sign-in is there.
    await expect(auditTable(page).getByText('Signed in').first()).toBeVisible();

    await page
      .getByRole('searchbox', { name: 'Search people or companies' })
      .fill(PLATFORM_ADMIN.email);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/[?&]q=admin%40adiutor\.test/);
    await expect(
      auditTable(page).getByRole('link', { name: PLATFORM_ADMIN.name }).first(),
    ).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Filter events' })
      .getByRole('link', { name: 'Sign-ins' })
      .click();
    await expect(page).toHaveURL(/[?&]group=sign-ins/);
    await expect(page).toHaveURL(/[?&]q=admin%40adiutor\.test/);
    await expect(auditTable(page)).toBeVisible();

    // Today, in UTC as the app shows times: the sign-in is still there, and the other filters stay.
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel('From', { exact: true }).fill(today);
    await page.getByLabel('To', { exact: true }).fill(today);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]from=${today}`));
    await expect(page).toHaveURL(/[?&]group=sign-ins/);
    await expect(auditTable(page).getByText('Signed in').first()).toBeVisible();

    // Clear removes only the dates.
    await page.getByRole('link', { name: 'Clear', exact: true }).click();
    await expect(page).not.toHaveURL(/[?&]from=/);
    await expect(page).toHaveURL(/[?&]group=sign-ins/);
  });

  test('a range with nothing in it, or the wrong way round, says so', async ({ page }) => {
    await page.goto('/admin/logs?from=2020-01-01&to=2020-01-02');
    await expect(page.getByText('Nothing in this selection')).toBeVisible();

    await page.goto('/admin/logs?from=2026-11-04&to=2026-11-03');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Choose a “from” date on or before the “to” date.',
    );
    // The range is left out, so the log still shows.
    await expect(auditTable(page)).toBeVisible();
  });

  test('a sign-in error is found by its reference, however it’s typed, and is in the recent list', async ({
    page,
    browser,
  }) => {
    // Someone signed out runs into a sign-in error and sends the reference.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto('/api/auth/error?error=state_mismatch&error_description=State%20mismatch');
    const reference = defined(
      await visitor.getByText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/).textContent(),
      'the reference',
    );
    await visitor.context().close();

    await page.goto('/admin/logs');
    await page
      .getByRole('navigation', { name: 'Log sections' })
      .getByRole('link', { name: 'Errors' })
      .click();
    await expect(page).toHaveURL('/admin/logs/errors');
    await expect(page.getByRole('link', { name: `Look up ${reference}` })).toBeVisible();

    await page
      .getByRole('searchbox', { name: 'Look up a reference' })
      .fill(reference.replace('-', ' ').toLowerCase());
    await page.getByRole('button', { name: 'Search' }).click();
    const result = page.getByRole('region', { name: `Reference ${reference}` });
    await expect(result).toContainText('Sign-in error');
    await expect(result).toContainText('state_mismatch');
    await expect(result).toContainText('State mismatch');
    await expect(result).toContainText('No one');

    await page.getByRole('searchbox', { name: 'Look up a reference' }).fill('ZZZZ-ZZZZ');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('Nothing recorded under ZZZZ-ZZZZ')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Look up a reference' }).fill('not one');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('That isn’t a reference')).toBeVisible();
  });
});

test('a Manager sees the audit log, without tabs, and not the errors', async ({ page }) => {
  await signIn(page, STEP_UP_MANAGER);
  await page.goto('/admin/logs');
  await expect(page.getByRole('heading', { level: 1, name: 'Logs' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Log sections' })).toHaveCount(0);
  await expect(auditTable(page)).toBeVisible();

  await page.goto('/admin/logs/errors');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('Support staff have no Logs', async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Logs', exact: true })).toHaveCount(0);

  await page.goto('/admin/logs');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
