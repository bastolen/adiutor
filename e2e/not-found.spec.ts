/**
 * @file End-to-end tests for the 404 page: its centered layout, the theme
 * button, and the ways out (the dashboard, and back when there's a previous
 * page). Pages someone may not see (a missing permission, an unknown user,
 * another company's request) show it with its title, "Not found · " and the
 * staff's name, while those who may see them get the page's own title.
 */
import { type Page } from '@playwright/test';

import { findUserId } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_SLUG,
  FIRST_PAGED_REQUEST_NUMBER,
  PLATFORM_ADMIN,
  SEEDED_REQUESTS,
  STAFF_NAME,
  STEP_UP_MANAGER,
  SUPPORT_STAFF,
} from './support/fixtures';
import { openUser, signIn } from './support/helpers';
import { inOrder } from './support/sequence';
import { signedInOnce } from './support/stored-sign-in';
import { expect, test } from './support/test';

/** The 404 page's title, which pages someone may not see have too. */
const NOT_FOUND_TITLE = `Not found · ${STAFF_NAME}`;

/** The staff pages and their titles, all of which staff Admins may see. */
const STAFF_PAGES = [
  { path: '/admin/users', title: `Users · ${STAFF_NAME}` },
  { path: '/admin/users/new', title: `Add user · ${STAFF_NAME}` },
  { path: '/admin/companies', title: `Companies · ${STAFF_NAME}` },
  { path: '/admin/companies/new', title: `Add company · ${STAFF_NAME}` },
  { path: '/admin/settings', title: `Settings · ${STAFF_NAME}` },
  { path: '/admin/settings/staff', title: `Staff · Settings · ${STAFF_NAME}` },
  { path: '/admin/settings/requests', title: `Requests · Settings · ${STAFF_NAME}` },
  { path: '/admin/settings/connections', title: `Connections · Settings · ${STAFF_NAME}` },
  { path: '/admin/logs', title: `Audit log · ${STAFF_NAME}` },
  { path: '/admin/logs/errors', title: `Errors · ${STAFF_NAME}` },
  { path: '/admin/logs/jobs', title: `Jobs · ${STAFF_NAME}` },
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

/** Gives the staff Admin's sign-in cookies, signed in once for the spec. */
const adminCookies = signedInOnce(PLATFORM_ADMIN);

test('signed in, an unknown page offers the dashboard and going back', async ({
  context,
  page,
}) => {
  await context.addCookies(adminCookies());
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
    await inOrder(
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
      `Request AD-${SEEDED_REQUESTS.waiting.number} · ${STAFF_NAME}`,
    );
    await expect(
      page.getByRole('heading', { level: 1, name: SEEDED_REQUESTS.waiting.title }),
    ).toBeVisible();

    await inOrder(
      [
        // The paging company's, the deactivated company's, numbers no request has, and a number
        // with another prefix than the current one (with "AD" it redirects to the number).
        `/requests/${FIRST_PAGED_REQUEST_NUMBER}`,
        `/requests/${SEEDED_REQUESTS.closedCompany.number}`,
        '/requests/999999',
        '/requests/0',
        '/requests/XY-1',
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
    await inOrder(
      [
        '/admin/users/new',
        '/admin/companies/new',
        '/admin/settings',
        '/admin/settings/staff',
        '/admin/settings/requests',
        '/admin/settings/connections',
        '/admin/logs',
        '/admin/logs/errors',
        '/admin/logs/jobs',
        companyPage('settings'),
      ],
      (path) => expectNotFound(page, path),
    );
    // A user's page, but not its Activity tab: Support see neither devices nor the audit log.
    const watcher = `/admin/users/${await findUserId(CLIENT_WATCHER.email)}`;
    await expectTitle(page, `${watcher}/companies`, `Companies · User · ${STAFF_NAME}`);
    await expectNotFound(page, `${watcher}/activity`);
    await expectTitle(page, '/admin/users', `Users · ${STAFF_NAME}`);
    await expectTitle(page, '/admin/companies', `Companies · ${STAFF_NAME}`);
    await expectTitle(page, companyPage('members'), `Members · ${COMPANY_NAME} · ${STAFF_NAME}`);
  });

  test('a staff Admin gets every staff page with its title, and it for unknown users', async ({
    context,
    page,
  }) => {
    await context.addCookies(adminCookies());
    await inOrder(STAFF_PAGES, ({ path, title }) => expectTitle(page, path, title));

    await openUser(page, PLATFORM_ADMIN.name);
    await expect(page).toHaveTitle(`User · ${STAFF_NAME}`);
    // Every tab of someone else's page, each with its title; your own page has no Manage tab.
    const watcher = `/admin/users/${await findUserId(CLIENT_WATCHER.email)}`;
    await inOrder(
      [
        { path: `${watcher}/companies`, title: `Companies · User · ${STAFF_NAME}` },
        { path: `${watcher}/activity`, title: `Activity · User · ${STAFF_NAME}` },
        { path: `${watcher}/manage`, title: `Manage · User · ${STAFF_NAME}` },
      ],
      ({ path, title }) => expectTitle(page, path, title),
    );
    await expectNotFound(page, `/admin/users/${await findUserId(PLATFORM_ADMIN.email)}/manage`);

    await expectNotFound(page, `/admin/users/${UNKNOWN_USER_ID}`);
    await expectNotFound(page, '/admin/users/not-an-id');
    // The address Settings had before it had tabs is gone, without a redirect.
    await expectNotFound(page, '/admin/staff');
  });
});
