/**
 * @file End-to-end tests for the users list, the staff navigation and
 * dashboard, the empty navigation of company users, and who sees which
 * provider account a user has.
 */

import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  GITHUB_ONLY_MANAGER,
  PLATFORM_ADMIN,
  SUPPORT_STAFF,
  UNVERIFIED_USER,
} from './support/fixtures';
import { signIn, useOwnClientIp } from './support/helpers';
import { expect, test } from './support/test';

test('an Admin finds users, recognises the staff and filters and searches the list', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText([
    'Dashboard',
    'Users',
    'Companies',
    'Staff',
    'Logs',
  ]);

  await page
    .getByRole('main')
    .getByRole('link', { name: /^Users/ })
    .click();
  await expect(page).toHaveURL('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  const rows = page.getByRole('row');
  const adminRow = rows.filter({ hasText: PLATFORM_ADMIN.email });
  await expect(adminRow.getByText('Staff · Admin')).toBeVisible();
  // Sorted by name, A to Z, until another order is chosen: E2E Admin comes first.
  await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(rows.nth(1)).toContainText(PLATFORM_ADMIN.email);
  const watcherRow = rows.filter({ hasText: CLIENT_WATCHER.email });
  await expect(watcherRow.getByRole('link', { name: COMPANY_NAME })).toBeVisible();

  const filters = page.getByRole('navigation', { name: 'Filter users' });
  await filters.getByRole('link', { name: 'Not staff' }).click();
  await expect(page).toHaveURL('/admin/users?filter=not_staff');
  await expect(filters.getByRole('link', { name: 'Not staff' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // The list loads within the page, so the link keeps focus.
  await expect(filters.getByRole('link', { name: 'Not staff' })).toBeFocused();
  // Scoped to the page content: the account menu also shows the signed-in email. Each address has
  // its own cell (and is repeated, hidden, under the name for phones).
  const main = page.getByRole('main');
  /**
   * Finds the Email cell of an address in the list.
   *
   * @param email - The address.
   * @returns The cell.
   */
  const emailCell = (email: string) => main.getByRole('cell', { name: email, exact: true });
  await expect(emailCell(PLATFORM_ADMIN.email)).toHaveCount(0);
  await expect(emailCell(CLIENT_WATCHER.email)).toBeVisible();

  // Searching keeps the filter, within the page: no new document (a marker on the window
  // survives), and focus stays on the Search button.
  await page.evaluate(() => {
    (window as unknown as { searchedInPage: boolean }).searchedInPage = true;
  });
  await page.getByRole('searchbox', { name: 'Search users' }).fill('UNVERIFIED');
  const search = page.getByRole('button', { name: 'Search' });
  await search.click();
  await expect(page).toHaveURL('/admin/users?filter=not_staff&q=UNVERIFIED');
  await expect(emailCell(UNVERIFIED_USER.email)).toBeVisible();
  await expect(emailCell(CLIENT_WATCHER.email)).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { searchedInPage?: boolean }).searchedInPage),
  ).toBe(true);
  await expect(search).toBeFocused();

  await filters.getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(page.getByText('No matching users')).toBeVisible();
});

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
  await useOwnClientIp(page);
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

test('only staff Admins see which GitHub account a user signs in with', async ({
  page,
  browser,
}) => {
  await useOwnClientIp(page);
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/admin/users?q=${encodeURIComponent(GITHUB_ONLY_MANAGER.email)}`);
  await page.getByRole('main').getByRole('link', { name: GITHUB_ONLY_MANAGER.name }).click();
  await expect(page.getByRole('heading', { name: GITHUB_ONLY_MANAGER.name })).toBeVisible();
  await expect(
    page.getByRole('main').getByText(GITHUB_ONLY_MANAGER.githubLogin, { exact: true }),
  ).toBeVisible();
  const userPage = page.url();

  // Support may view users, but not which account they have at a provider.
  const context = await browser.newContext();
  const support = await context.newPage();
  await useOwnClientIp(support);
  await signIn(support, SUPPORT_STAFF);
  await support.goto(userPage);
  await expect(support.getByRole('heading', { name: GITHUB_ONLY_MANAGER.name })).toBeVisible();
  // The GitHub row says only "Connected" (next to its 2FA badge).
  await expect(
    support
      .getByRole('main')
      .getByRole('definition')
      .filter({ hasText: /^Connected/ }),
  ).toBeVisible();
  await expect(support.getByText(GITHUB_ONLY_MANAGER.githubLogin)).toHaveCount(0);
  await context.close();
});
