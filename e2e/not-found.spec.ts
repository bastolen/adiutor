/**
 * @file End-to-end tests for the 404 page: its centered layout, the theme
 * button, and the ways out (the dashboard, and back when there's a previous
 * page). Pages someone may not see (a missing permission, an unknown user,
 * another company's request) show it with its title, "Not found · Adiutor",
 * while those who may see them get the page's own title.
 */
import { type Page } from '@playwright/test';

import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_SLUG,
  FIRST_PAGED_REQUEST_NUMBER,
  PLATFORM_ADMIN,
  SEEDED_REQUESTS,
  STEP_UP_MANAGER,
  SUPPORT_STAFF,
} from './support/fixtures';
import { adminStorageState, openUser, signIn, type StorageState } from './support/helpers';
import { expect, test } from './support/test';

/** The 404 page's title, which pages someone may not see have too. */
const NOT_FOUND_TITLE = 'Not found · Adiutor';

/** The staff pages and their titles, all of which staff Admins may see. */
const STAFF_PAGES = [
  { path: '/admin/users', title: 'Users · Adiutor' },
  { path: '/admin/users/new', title: 'Add user · Adiutor' },
  { path: '/admin/companies', title: 'Companies · Adiutor' },
  { path: '/admin/companies/new', title: 'Add company · Adiutor' },
  { path: '/admin/staff', title: 'Staff · Adiutor' },
  { path: '/admin/logs', title: 'Audit log · Adiutor' },
  { path: '/admin/logs/errors', title: 'Errors · Adiutor' },
  { path: '/admin/logs/jobs', title: 'Jobs · Adiutor' },
] as const;

/** An ID no user has. */
const UNKNOWN_USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

/**
 * The address of one of the seeded company's pages.
 *
 * @param tab - The page, e.g. `members`.
 * @returns Its path.
 */
const companyPage = (tab: string) => `/companies/${COMPANY_SLUG}/${tab}`;

/**
 * Runs a check on each item, one after another (they share the tab).
 *
 * @param items - The items.
 * @param check - The check.
 */
async function eachInTurn<T>(items: readonly T[], check: (item: T) => Promise<void>) {
  await items.reduce(async (previous, item) => {
    await previous;
    await check(item);
  }, Promise.resolve());
}

/**
 * Opens a page and checks it's the 404 page, with the 404 page's title.
 *
 * @param page - The browser page.
 * @param path - The page's path.
 */
async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page, path).toHaveTitle(NOT_FOUND_TITLE);
}

/**
 * Opens a page and checks its title.
 *
 * @param page - The browser page.
 * @param path - The page's path.
 * @param title - The title it should have.
 */
async function expectTitle(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(page, path).toHaveTitle(title);
}

/** Sign-in cookies of the staff Admin. */
let adminState: StorageState;

test.beforeAll(async ({ browser }) => {
  adminState = await adminStorageState(browser);
});

test('signed in, an unknown page offers the dashboard and going back', async ({
  context,
  page,
}) => {
  await context.addCookies(adminState.cookies);
  await page.goto('/dashboard');

  const response = await page.goto('/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByText('404', { exact: true })).toBeVisible();
  // No account menu here, so the floating theme button is.
  await expect(page.getByRole('button', { name: /^Account menu/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Theme and language:/ })).toBeVisible();

  await page.getByRole('button', { name: 'Go back' }).click();
  await expect(page).toHaveURL('/dashboard');

  await page.goto('/does-not-exist');
  await page.getByRole('link', { name: 'Go to your dashboard' }).click();
  await expect(page).toHaveURL('/dashboard');
});

test('opened in a new tab while signed out, it offers signing in and nothing to go back to', async ({
  page,
}) => {
  await page.goto('/auth/does-not-exist');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to your dashboard' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go back' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page).toHaveURL('/auth');
});

test.describe('pages someone may not see are titled like the 404 page', () => {
  test('a company user gets it on every staff page and on company pages beyond their role', async ({
    page,
  }) => {
    await signIn(page, CLIENT_WATCHER);
    await eachInTurn(
      [
        ...STAFF_PAGES.map(({ path }) => path),
        `/admin/users/${UNKNOWN_USER_ID}`,
        companyPage('members'),
        companyPage('settings'),
      ],
      async (path) => {
        await expectNotFound(page, path);
        // No other user's data leaks onto the page.
        await expect(page.getByText(STEP_UP_MANAGER.email)).toHaveCount(0);
      },
    );
  });

  test('a company user gets it on another company’s request, and on a request that doesn’t exist', async ({
    page,
  }) => {
    await signIn(page, CLIENT_WATCHER);
    // Their own company's request is named by its number, never by its title.
    await expectTitle(
      page,
      `/requests/${SEEDED_REQUESTS.waiting.number}`,
      'Request AD-1 · Adiutor',
    );
    await expect(
      page.getByRole('heading', { level: 1, name: SEEDED_REQUESTS.waiting.title }),
    ).toBeVisible();

    await eachInTurn(
      [
        // The paging company's, the deactivated company's, and numbers no request has.
        `/requests/${FIRST_PAGED_REQUEST_NUMBER}`,
        `/requests/${SEEDED_REQUESTS.closedCompany.number}`,
        '/requests/999999',
        '/requests/0',
        '/requests/AD-1',
      ],
      async (path) => {
        await expectNotFound(page, path);
        // Nothing of the request shows on the way.
        await expect(page.getByText('Paged request')).toHaveCount(0);
        await expect(page.getByText(SEEDED_REQUESTS.closedCompany.title)).toHaveCount(0);
      },
    );
  });

  test('Support staff get it on the staff pages beyond their role, and titles elsewhere', async ({
    page,
  }) => {
    await signIn(page, SUPPORT_STAFF);
    await eachInTurn(
      [
        '/admin/users/new',
        '/admin/companies/new',
        '/admin/staff',
        '/admin/logs',
        '/admin/logs/errors',
        '/admin/logs/jobs',
        companyPage('settings'),
      ],
      (path) => expectNotFound(page, path),
    );
    await expectTitle(page, '/admin/users', 'Users · Adiutor');
    await expectTitle(page, '/admin/companies', 'Companies · Adiutor');
    await expectTitle(page, companyPage('members'), `Members · ${COMPANY_NAME} · Adiutor`);
  });

  test('a staff Admin gets every staff page with its title, and it for unknown users', async ({
    context,
    page,
  }) => {
    await context.addCookies(adminState.cookies);
    await eachInTurn(STAFF_PAGES, ({ path, title }) => expectTitle(page, path, title));

    await openUser(page, PLATFORM_ADMIN.name);
    await expect(page).toHaveTitle('User · Adiutor');

    await expectNotFound(page, `/admin/users/${UNKNOWN_USER_ID}`);
    await expectNotFound(page, '/admin/users/not-an-id');
  });
});
