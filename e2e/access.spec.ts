/**
 * @file End-to-end tests for which pages need signing in, what a Watcher can
 * see, and what staff see on a company's page.
 */

import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_SLUG,
  PLATFORM_ADMIN,
  SEEDED_REQUESTS,
  STAFF_NAME,
} from './support/fixtures';
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
  const companyUrl = `/companies/${COMPANY_SLUG}`;
  await page.goto(companyUrl);
  await expect(page.getByRole('heading', { name: COMPANY_NAME })).toBeVisible();
  // They follow the company's requests, without a way to raise one or to see its members.
  await expect(page.getByRole('main').getByText(SEEDED_REQUESTS.open.title)).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'New request' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);

  await page.goto(`${companyUrl}/members`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.goto('/admin/companies');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('staff see a company’s requests on its page, and can raise one for it', async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.getByRole('link', { name: 'Companies' }).first().click();
  await page.getByRole('row').filter({ hasText: COMPANY_SLUG }).getByRole('link').click();

  await expect(page).toHaveTitle(`Requests · ${COMPANY_NAME} · ${STAFF_NAME}`);
  const main = page.getByRole('main');
  await expect(main.getByText(SEEDED_REQUESTS.open.title)).toBeVisible();
  // Only this company's: the list names no company, and has no company to filter by.
  await expect(main.getByText('Paged request')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Company', exact: true })).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'New request' })).toHaveAttribute(
    'href',
    `/requests/new?company=${COMPANY_SLUG}`,
  );
});
