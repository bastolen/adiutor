/**
 * @file Accessibility scans of every page, in light and dark mode, against
 * the WCAG 2.2 A and AA rules, plus a reflow check on a narrow screen. The
 * invitation and invite-link pages are scanned with real tokens (stored in
 * `beforeAll`), signed out and signed in. `/setup` is scanned in
 * `setup.spec.ts`, the only place the database is empty.
 */
import { randomUUID } from 'node:crypto';

import { type Page } from '@playwright/test';

import expectAccessible from './support/axe';
import { findCompanyId, storeInvitation, storeInviteLink, storeSignInLink } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_SLUG,
  PAGING_COMPANY_SLUG,
  PLATFORM_ADMIN,
} from './support/fixtures';
import {
  adminStorageState,
  openSignInLink,
  type StorageState,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { expect, test } from './support/test';
import { defined } from '../src/lib/defined';
import {
  PROVIDER_LINKED_COOKIE,
  PROVIDER_STEP_UP_COOKIE,
  providerLinkedCookieValue,
  providerStepUpCookieValue,
} from '../src/lib/sign-in/oauth-providers';
import {
  REVERIFY_WRONG_ACCOUNT,
  reverifyWrongAccountMessage,
} from '../src/lib/sign-in/sign-in-refusals';
import getTestDatabaseUrl from '../tests/database/database-url';

/** Pages that work signed out. */
const PUBLIC_PATHS = [
  '/auth',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/reset-password?token=not-a-real-token',
  '/invite/not-a-real-token',
  '/join/not-a-real-token',
  '/auth/does-not-exist',
  '/auth/two-factor?methods=totp,otp',
  '/auth/email-link?token=not-a-real-token',
  '/auth/email-link',
  '/sign-in-error?error=state_mismatch',
  '/sign-in-error',
];

/**
 * Signed-in pages; `{company}` is the seeded company's ID and
 * `{user}` the seeded Watcher's.
 */
const APP_PATHS = [
  '/dashboard',
  '/admin/companies',
  '/admin/companies?q=no-such-company',
  '/admin/companies/new',
  '/admin/users',
  '/admin/users?filter=not_staff&q=no-such-user',
  '/admin/users/{user}',
  '/admin/users/new',
  '/admin/staff',
  '/admin/logs',
  '/admin/logs?group=people&q=no-such-person',
  '/admin/logs/errors',
  '/admin/logs/errors?q=ZZZZ-ZZZZ',
  '/admin/logs/errors?q=not-a-reference',
  '/account',
  '/account/security',
  '/companies/{company}',
  '/companies/{company}/members',
  // More members and invite links than fit on a page: pagination, a sorted column, the last page.
  '/companies/{paging}/members',
  '/companies/{paging}/members?page=2&sort=joined',
  '/companies/{company}/settings',
  '/companies/does-not-exist',
  '/does-not-exist',
];

/** Sign-in cookies of the staff Admin, shared by the signed-in scans. */
let adminState: StorageState;

/** ID of the seeded company. */
let companyId: string;

/** ID of the seeded Watcher. */
let userId: string;

/** ID of the seeded company with more members than fit on a page. */
let pagingCompanyId: string;

/** An invitation to the seeded company for an address without an account. */
let newAddressInvitationPath: string;

/** An invitation to the seeded company for the staff Admin's address. */
let adminInvitationPath: string;

/** An invite link to the seeded company. */
let inviteLinkPath: string;

/**
 * Fills in the IDs in a path.
 *
 * @param path - A path from {@link APP_PATHS}.
 * @returns The URL to open.
 */
const resolvePath = (path: string) =>
  path
    .replace('{company}', companyId)
    .replace('{paging}', pagingCompanyId)
    .replace('{user}', userId);

test.beforeAll(async ({ browser }) => {
  companyId = await findCompanyId(getTestDatabaseUrl(), COMPANY_SLUG);
  pagingCompanyId = await findCompanyId(getTestDatabaseUrl(), PAGING_COMPANY_SLUG);
  // Unique per run: an address may have only one open invitation per company.
  newAddressInvitationPath = await storeInvitation(getTestDatabaseUrl(), {
    companyId,
    email: `a11y-${randomUUID().slice(0, 8)}@adiutor.test`,
    role: 'client',
  });
  adminInvitationPath = await storeInvitation(getTestDatabaseUrl(), {
    companyId,
    email: PLATFORM_ADMIN.email,
    role: 'client',
  });
  inviteLinkPath = await storeInviteLink(getTestDatabaseUrl(), { companyId, role: 'client' });
  adminState = await adminStorageState(browser, async (page) => {
    await page.goto(`/admin/users?q=${encodeURIComponent(CLIENT_WATCHER.name)}`);
    const userHref = await page
      .getByRole('main')
      .getByRole('link', { name: CLIENT_WATCHER.name, exact: true })
      .getAttribute('href');
    userId = defined(defined(userHref, "the user's link").split('/').at(-1), "the user's ID");
  });
});

/**
 * Checks that the page doesn't scroll sideways (WCAG 1.4.10 Reflow). Wide
 * tables may scroll inside their own container; the page itself must not.
 *
 * @param page - The browser page.
 */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe('on a 320px wide screen', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  PUBLIC_PATHS.forEach((path) => {
    test(`${path} fits without sideways scrolling`, async ({ page }) => {
      await page.goto(path);
      await expectNoSidewaysScroll(page);
    });
  });

  test('a sign-in link page that names the account fits without sideways scrolling', async ({
    page,
  }) => {
    await page.goto(await storeSignInLink(getTestDatabaseUrl(), CLIENT_WATCHER.email));
    await expectNoSidewaysScroll(page);
  });

  APP_PATHS.forEach((path) => {
    test(`${path} fits without sideways scrolling`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: adminState,
        viewport: { width: 320, height: 640 },
      });
      const page = await context.newPage();
      await page.goto(resolvePath(path));
      await expectNoSidewaysScroll(page);
      await context.close();
    });
  });
});

(['light', 'dark'] as const).forEach((colorScheme) => {
  test.describe(`${colorScheme} mode`, () => {
    // Overlays animate in; with reduced motion they appear at once, so axe sees final colours.
    test.use({ colorScheme, reducedMotion: 'reduce' });

    PUBLIC_PATHS.forEach((path) => {
      test(`${path} signed out`, async ({ page }) => {
        await page.goto(path);
        await expectAccessible(page);
      });
    });

    test('an invitation’s account form, signed out', async ({ page }) => {
      await page.goto(newAddressInvitationPath);
      await expect(page.getByLabel('Your name')).toBeVisible();
      await expectAccessible(page);
    });

    test('an invite link’s email form, signed out', async ({ page }) => {
      await page.goto(inviteLinkPath);
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
      await expectAccessible(page);
    });

    test('the theme menu, signed out', async ({ page }) => {
      await page.goto('/auth');
      await page.getByRole('button', { name: /^Theme:/ }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, '[role="menu"]');
    });

    test('a sign-in link page that names the account, signed out', async ({ page }) => {
      await page.goto(await storeSignInLink(getTestDatabaseUrl(), CLIENT_WATCHER.email));
      await expect(page.getByText(CLIENT_WATCHER.name, { exact: true })).toBeVisible();
      await expectAccessible(page);
    });

    // Only reachable signed in without a recent second step, so it can't be in APP_PATHS: the
    // Admin signs in with an email link, which doesn't count as one.
    test('the step-up page, after signing in with an email link', async ({ page }) => {
      await useOwnClientIp(page);
      await openSignInLink(page, await storeSignInLink(getTestDatabaseUrl(), PLATFORM_ADMIN.email));
      await expect(page).toHaveURL(/\/auth\/verify\?callbackURL=%2Fdashboard/);
      await expect(page.getByRole('heading', { name: /^Confirm it.s you$/ })).toBeVisible();
      await expectAccessible(page);
    });

    test('the step-up page, after "Confirm with GitHub" didn’t confirm the session', async ({
      context,
      page,
    }) => {
      await useOwnClientIp(page);
      await openSignInLink(page, await storeSignInLink(getTestDatabaseUrl(), PLATFORM_ADMIN.email));
      await expect(page).toHaveURL(/\/auth\/verify\?callbackURL=%2Fdashboard/);
      // GitHub isn't configured in these tests: the browser gets the cookie its callback leaves.
      await context.addCookies([
        {
          name: PROVIDER_STEP_UP_COOKIE,
          value: encodeURIComponent(providerStepUpCookieValue('github', 'mfa-off')),
          url: page.url(),
        },
      ]);
      await page.reload();
      await expect(page.getByRole('region', { name: 'GitHub confirmation' })).toBeVisible();
      await expectAccessible(page);
    });

    test('the step-up page, after "Confirm with GitHub" signed in with a different GitHub account', async ({
      page,
    }) => {
      await useOwnClientIp(page);
      await openSignInLink(page, await storeSignInLink(getTestDatabaseUrl(), PLATFORM_ADMIN.email));
      await expect(page).toHaveURL(/\/auth\/verify\?callbackURL=%2Fdashboard/);
      // GitHub isn't configured in these tests: the browser comes back as the refusal sends it.
      await page.goto(
        `/auth/verify?${new URLSearchParams({
          callbackURL: '/dashboard',
          provider: 'github',
          error: REVERIFY_WRONG_ACCOUNT.code,
        })}`,
      );
      const message = reverifyWrongAccountMessage('GitHub');
      await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
      await expectAccessible(page);
    });

    test.describe('signed in', () => {
      APP_PATHS.forEach((path) => {
        test(path, async ({ browser }) => {
          const context = await browser.newContext({
            storageState: adminState,
            colorScheme,
            reducedMotion: 'reduce',
          });
          const page = await context.newPage();
          await page.goto(resolvePath(path));
          await expectAccessible(page);
          await context.close();
        });
      });

      test('an invitation addressed to the signed-in user, and an invite link', async ({
        browser,
      }) => {
        const context = await browser.newContext({
          storageState: adminState,
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.goto(adminInvitationPath);
        await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
        await expectAccessible(page);
        await page.goto(inviteLinkPath);
        await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
        await expectAccessible(page);
        await context.close();
      });

      test('a toast', async ({ browser }) => {
        const context = await browser.newContext({
          storageState: adminState,
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        // Saving the staff name unchanged changes nothing, but shows its toast.
        await page.goto('/admin/staff');
        await page.getByRole('button', { name: 'Save name' }).click();
        await expect(toasts(page)).toContainText('Name saved.');
        await expectAccessible(page);
        await context.close();
      });

      test('a sign-in link page for another account', async ({ browser }) => {
        const context = await browser.newContext({
          storageState: adminState,
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.goto(await storeSignInLink(getTestDatabaseUrl(), CLIENT_WATCHER.email));
        await expect(page.getByRole('status')).toBeVisible();
        await expectAccessible(page);
        await context.close();
      });

      test('the notice after a provider was connected at sign-in', async ({ browser }) => {
        const context = await browser.newContext({
          storageState: adminState,
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.goto('/dashboard');
        await context.addCookies([
          {
            name: PROVIDER_LINKED_COOKIE,
            value: encodeURIComponent(providerLinkedCookieValue('github', 'adiutor-tests')),
            url: page.url(),
          },
        ]);
        await page.reload();
        await expect(page.getByRole('region', { name: 'GitHub connected' })).toBeVisible();
        await expectAccessible(page);
        await context.close();
      });

      test('open menus, selects and dialogs', async ({ browser }) => {
        const context = await browser.newContext({
          storageState: adminState,
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.goto(`/companies/${companyId}/members`);

        await page.getByRole('button', { name: /^Account menu/ }).click();
        await expect(page.getByRole('menu')).toBeVisible();
        await expectAccessible(page, '[role="menu"]');
        await page.keyboard.press('Escape');

        await page.getByRole('combobox', { name: `Role of ${CLIENT_WATCHER.name}` }).click();
        await expect(page.getByRole('listbox')).toBeVisible();
        await expectAccessible(page, '[role="listbox"]');
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: `Remove ${CLIENT_WATCHER.name}` }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await expectAccessible(page, '[role="alertdialog"]');
        await page.getByRole('button', { name: 'Cancel' }).click();
        await context.close();
      });

      test('the sort menu on a phone', async ({ browser }) => {
        const context = await browser.newContext({
          storageState: adminState,
          colorScheme,
          reducedMotion: 'reduce',
          viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();
        await page.goto(resolvePath('/companies/{paging}/members'));

        await page.getByRole('button', { name: 'Sort members' }).click();
        await expect(page.getByRole('menu')).toBeVisible();
        await expectAccessible(page, '[role="menu"]');
        await context.close();
      });

      test('the mobile menu', async ({ browser }) => {
        const context = await browser.newContext({
          storageState: adminState,
          colorScheme,
          reducedMotion: 'reduce',
          viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();
        await page.goto('/dashboard');
        await expectAccessible(page);

        await page.getByRole('button', { name: 'Open menu' }).click();
        const menu = page.getByRole('dialog', { name: 'Menu' });
        await expect(menu).toBeVisible();
        await expectAccessible(page, '[role="dialog"]');

        await menu.getByRole('button', { name: /^Account menu/ }).click();
        await expect(page.getByRole('menu')).toBeVisible();
        await expectAccessible(page, '[role="menu"]');
        await context.close();
      });
    });
  });
});
