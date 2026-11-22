/**
 * @file End-to-end tests for the dashboard and the main navigation: the
 * Settings from the dashboard and the menu, what staff who can't manage the
 * staff see (and the tile of the requests assigned to them), the warning about users whose MFA came from a provider that is
 * off, and what company users get: Requests in the menu and on the
 * dashboard, and their companies.
 */

import {
  COMPANY_NAME,
  COMPANY_SLUG,
  GITHUB_ONLY_MANAGER,
  PLATFORM_ADMIN,
  REQUESTS_CLIENT,
  SEEDED_REQUESTS,
  SUPPORT_STAFF,
} from './support/fixtures';
import { signIn } from './support/helpers';
import { expect, test } from './support/test';

test('an Admin opens Settings from the dashboard and the menu', async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/dashboard');

  // Each tile is named by its title, then its description.
  const main = page.getByRole('main');
  await expect(main.getByRole('listitem').getByRole('link')).toHaveText([
    /^Requests/,
    /^Assigned to you/,
    /^Users/,
    /^Companies/,
    /^Settings/,
    /^Logs/,
  ]);
  await main.getByRole('link', { name: /^Settings/ }).click();
  await expect(page).toHaveURL('/admin/settings');
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'Staff' })
    .click();
  await expect(page).toHaveURL('/admin/settings/staff');
  // The staff table shows each address under the name.
  await expect(
    page.getByRole('main').getByRole('row').filter({ hasText: PLATFORM_ADMIN.email }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }),
  ).toHaveAttribute('aria-current', 'page');
});

test("staff who can't manage the staff get no Settings tile or menu item", async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);
  await page.goto('/dashboard');

  const tiles = page.getByRole('main').getByRole('listitem').getByRole('link');
  await expect(tiles).toHaveText([/^Requests/, /^Assigned to you/, /^Users/, /^Companies/]);
  // Support works on requests: the tile leads to the ones assigned to them.
  await expect(tiles.filter({ hasText: /^Assigned to you/ })).toHaveAttribute(
    'href',
    '/requests?assignee=me',
  );
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
    'Dashboard',
    'Requests',
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

test('company users get Requests in the menu and on the dashboard, and their companies', async ({
  page,
}) => {
  // An account no other test changes, so it stays in one company.
  await signIn(page, REQUESTS_CLIENT);

  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Welcome, /);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Dashboard', 'Requests']);
  const main = page.getByRole('main');
  await expect(main).toContainText('Raise a request, or see how the open ones are coming along.');

  // The tile and the menu item both open the requests they may see.
  await main.getByRole('link', { name: /^Requests/ }).click();
  await expect(page).toHaveURL('/requests');
  await expect(main.getByText(SEEDED_REQUESTS.open.title)).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL('/dashboard');

  // Their company, with their role in it, is the way to its page.
  const company = page.getByRole('region', { name: 'Your company' });
  await expect(company.getByRole('listitem')).toHaveText(new RegExp(`${COMPANY_NAME}\\s*Client$`));
  await company.getByRole('link', { name: COMPANY_NAME }).click();
  await expect(page).toHaveURL(`/companies/${COMPANY_SLUG}`);
  await expect(page).toHaveTitle(`Requests · ${COMPANY_NAME} · Adiutor`);

  // The staff pages stay out of reach.
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
