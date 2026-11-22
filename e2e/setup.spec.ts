/**
 * @file End-to-end tests for first-run setup. The first test empties the
 * test database to simulate a fresh install, and re-seeds it afterwards so
 * the other specs keep their data.
 */

import expectAccessible from './support/axe';
import { defaultTimeZoneNow, removeStaffSettings, savedTimeZoneOf } from './support/db';
import { STAFF_NAME } from './support/fixtures';
import seedTestDatabase, { emptyTestDatabase } from './support/seed';
import { expect, test } from './support/test';

test.describe('first run', () => {
  /** Set up from a browser in Amsterdam, whose zone becomes Adiutor's default and the Admin's. */
  test.use({ timezoneId: 'Europe/Amsterdam' });

  test.afterAll(async () => {
    await seedTestDatabase();
  });

  test('sign-in redirects to setup, which names the staff, sets the default language and zone and creates its Admin', async ({
    browser,
    page,
  }) => {
    await emptyTestDatabase();

    await page.goto('/auth');
    await expect(page).toHaveURL('/setup');

    // Only reachable on an empty database, so its accessibility scan lives here.
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectAccessible(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectAccessible(page);

    // Before setup there's no default language, so a page follows what the browser asks for.
    const dutchBrowser = await browser.newContext({ locale: 'nl-NL' });
    try {
      const dutchPage = await dutchBrowser.newPage();
      await dutchPage.goto('/setup');
      await expect(dutchPage.locator('html')).toHaveAttribute('lang', 'nl-NL');
    } finally {
      await dutchBrowser.close();
    }

    await page.getByLabel('Name shown to users').fill(STAFF_NAME);
    const defaultLanguage = page.getByRole('combobox', { name: 'Default language' });
    await expect(defaultLanguage).toHaveText('English (US)');
    await defaultLanguage.click();
    await page.getByRole('option', { name: 'Nederlands' }).click();
    await page.getByLabel('Your name').fill('Setup Admin');
    await page.getByLabel('Email').fill('setup@adiutor.test');
    await page.getByLabel('Password').fill('setup-password-1');
    await page.getByRole('button', { name: 'Set up Adiutor' }).click();

    // Admins must protect their account first, so they land on the Security page, in the
    // language they set up in.
    await expect(page).toHaveURL('/account/security?setup=required');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Companies' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Staff' })).toHaveAttribute('href', '/admin/staff');

    // The browser's zone is Adiutor's default zone and the Admin's own, which their Profile shows.
    expect(await defaultTimeZoneNow()).toBe('Europe/Amsterdam');
    expect(await savedTimeZoneOf('setup@adiutor.test')).toBe('Europe/Amsterdam');
    await page.goto('/account');
    await expect(page.getByRole('combobox', { name: 'Time zone' })).toContainText('Amsterdam');

    // Setup is now disabled.
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    // Visitors without a choice get the default language chosen at setup.
    const visitor = await browser.newContext();
    try {
      const visitorPage = await visitor.newPage();
      await visitorPage.goto('/auth');
      await expect(visitorPage.locator('html')).toHaveAttribute('lang', 'nl-NL');
    } finally {
      await visitor.close();
    }
  });

  test("isn't offered once accounts exist, even if nothing is set up", async ({ page }) => {
    // E.g. the staff settings row was lost: accounts exist, but there's no settings row.
    await seedTestDatabase();
    await removeStaffSettings();

    await page.goto('/auth');
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveTitle('Not found · Adiutor');
  });
});
