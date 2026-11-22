/**
 * @file End-to-end tests for the users list: the order, filters and search.
 */

import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  PLATFORM_ADMIN,
  SUPPORT_STAFF,
  UNVERIFIED_USER,
} from './support/fixtures';
import { signIn } from './support/helpers';
import { expect, test } from './support/test';

test('an Admin finds users, recognises the staff and filters and searches the list', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText([
    'Dashboard',
    'Requests',
    'Users',
    'Companies',
    'Settings',
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
  // Sorted by name, A to Z, until another order is chosen: E2E Admin before E2E Support. Other
  // specs add users, so the Admin needn't be the first row.
  await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  const rowTexts = await rows.allInnerTexts();
  const adminRowIndex = rowTexts.findIndex((text) => text.includes(PLATFORM_ADMIN.email));
  expect(adminRowIndex).toBeGreaterThan(0);
  expect(adminRowIndex).toBeLessThan(
    rowTexts.findIndex((text) => text.includes(SUPPORT_STAFF.email)),
  );
  const watcherRow = rows.filter({ hasText: CLIENT_WATCHER.email });
  await expect(watcherRow.getByRole('link', { name: COMPANY_NAME })).toBeVisible();
  // The Admin's own row says so; nobody else's does.
  await expect(adminRow.getByText('You', { exact: true })).toBeVisible();
  await expect(watcherRow.getByText('You', { exact: true })).toHaveCount(0);

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
  // Short enough to fit the field on a small phone; its label says what it searches.
  await expect(page.getByRole('searchbox', { name: 'Search users' })).toHaveAttribute(
    'placeholder',
    'Name or email',
  );
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
