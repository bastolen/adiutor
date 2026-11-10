/**
 * @file End-to-end tests for which pages need signing in, what a Watcher can
 * see, and what staff see on a company's overview.
 */

import getTestDatabaseUrl from '../tests/database/database-url';
import { findCompanyId } from './support/db';
import { CLIENT_WATCHER, COMPANY_NAME, COMPANY_SLUG, PLATFORM_ADMIN } from './support/fixtures';
import { signIn } from './support/helpers';
import { expect, test } from './support/test';

['/', '/companies/x', '/admin/companies', '/account'].forEach((path) => {
  test(`signed out, ${path} redirects to sign in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth(\?|$)/);
  });
});

['/invite/not-a-real-token', '/join/not-a-real-token'].forEach((path) => {
  test(`signed out, ${path} loads and explains the link is unusable`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: "This link can't be used" })).toBeVisible();
  });
});

test('a Watcher can view the company but not manage its members', async ({ page }) => {
  await signIn(page, CLIENT_WATCHER);
  // Company users have no links yet, so open the company directly.
  const companyUrl = `/companies/${await findCompanyId(getTestDatabaseUrl(), COMPANY_SLUG)}`;
  await page.goto(companyUrl);
  await expect(page.getByRole('heading', { name: COMPANY_NAME })).toBeVisible();
  // In the page content: right after loading, React's streamed copy may still be in the document.
  await expect(
    page.getByRole('main').getByText('You have view-only access to this company.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);

  await page.goto(`${companyUrl}/members`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.goto('/admin/companies');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test("staff see what's coming on a company's overview, not a view-only notice", async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.getByRole('link', { name: 'Companies' }).first().click();
  await page.getByRole('row').filter({ hasText: COMPANY_SLUG }).getByRole('link').click();

  await expect(page.getByText('Requests are on their way')).toBeVisible();
  await expect(page.getByText(`Requests from ${COMPANY_NAME} will appear here.`)).toBeVisible();
  await expect(page.getByText('View-only access')).toHaveCount(0);
});
