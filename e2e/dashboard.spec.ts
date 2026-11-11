/**
 * @file End-to-end tests for the dashboard and the main navigation: the
 * staff page from the dashboard and the menu, what staff who can't manage the
 * staff see, the warning about users whose MFA came from a provider that is
 * off, and the empty navigation of company users.
 */

import {
  CLIENT_WATCHER,
  GITHUB_ONLY_MANAGER,
  PLATFORM_ADMIN,
  SUPPORT_STAFF,
} from './support/fixtures';
import { signIn } from './support/helpers';
import { expect, test } from './support/test';

test('an Admin opens the staff page from the dashboard and the menu', async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/dashboard');

  // Each tile is named by its title, then its description.
  const main = page.getByRole('main');
  await expect(main.getByRole('listitem').getByRole('link')).toHaveText([
    /^Users/,
    /^Companies/,
    /^Staff/,
    /^Logs/,
  ]);
  await main.getByRole('link', { name: /^Staff/ }).click();
  await expect(page).toHaveURL('/admin/staff');
  // The staff table shows each address under the name.
  await expect(
    page.getByRole('main').getByRole('row').filter({ hasText: PLATFORM_ADMIN.email }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Staff' }),
  ).toHaveAttribute('aria-current', 'page');
});

test("staff who can't manage the staff get no Staff tile or menu item", async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);
  await page.goto('/dashboard');

  await expect(page.getByRole('main').getByRole('listitem').getByRole('link')).toHaveText([
    /^Users/,
    /^Companies/,
  ]);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
    'Dashboard',
    'Users',
    'Companies',
  ]);
});

test('a staff Admin is warned about users whose MFA came from a provider that is off', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/dashboard');

  // GitHub sign-in is off in these tests, and one Manager signs in only with GitHub (2FA on).
  const warning = page.getByRole('region', { name: 'Users without MFA' });
  await expect(warning).toContainText("GitHub sign-in isn't configured on this server");
  await expect(warning).toContainText('1 user whose role requires MFA has no MFA now');
  await warning.getByRole('link', { name: 'See users without MFA' }).click();
  await expect(page).toHaveURL('/admin/users?filter=without_mfa');
  await expect(
    page.getByRole('main').getByRole('cell', { name: GITHUB_ONLY_MANAGER.email, exact: true }),
  ).toBeVisible();
});

test('company users get an empty menu and dashboard for now', async ({ page }) => {
  await signIn(page, CLIENT_WATCHER);

  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Welcome, /);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  // Only the MFA recommendation links somewhere (to the Security page).
  await expect(
    page.getByRole('main').getByRole('link').filter({ hasNotText: 'Set up' }),
  ).toHaveCount(0);

  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
