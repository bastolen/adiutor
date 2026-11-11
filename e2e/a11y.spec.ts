/**
 * @file Accessibility scans of every page, in light and dark mode, against
 * the WCAG 2.2 A and AA rules, plus a reflow check on a narrow screen (for
 * signed-in pages also while they still show their loading placeholders) and
 * a check that no field is small enough for phones to zoom in on. The
 * invitation and invite-link pages are scanned with real tokens (stored in
 * `beforeAll`), signed out and signed in. `/setup` is scanned in
 * `setup.spec.ts`, the only place the database is empty.
 */
import { randomUUID } from 'node:crypto';

import { type BrowserContext, type Page } from '@playwright/test';

import { defined } from '../src/lib/defined';
import { LAST_USED_LOGIN_METHOD_COOKIE } from '../src/lib/sign-in/auth-cookies';
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
import expectAccessible from './support/axe';
import { findCompanyId, storeInvitation, storeInviteLink, storeSignInLink } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_SLUG,
  E2E_BASE_URL,
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
 * Checks that the page as it is now doesn't scroll sideways (WCAG 1.4.10
 * Reflow). Wide tables may scroll inside their own container; the page itself
 * must not.
 *
 * @param page - The browser page.
 */
async function expectFitsNow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/**
 * Checks that no box cuts off content wider than itself, as a card does with a
 * button that runs past its edge: the page doesn't scroll, so
 * {@link expectFitsNow} can't see it. Deliberate truncation (`…`), visually
 * hidden text and areas that scroll on purpose don't count.
 *
 * @param page - The browser page.
 */
async function expectNothingClipped(page: Page): Promise<void> {
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const clips = [style.overflowX, style.overflow].some((value) =>
          ['hidden', 'clip'].includes(value),
        );
        // A field's own text scrolls inside it, so fields don't count.
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
          return false;
        }
        // Visually hidden until focused or read out, like the skip link (`sr-only`).
        const visuallyHidden =
          element.classList.contains('sr-only') ||
          style.clip === 'rect(0px, 0px, 0px, 0px)' ||
          style.clipPath === 'inset(50%)';
        return (
          clips &&
          !visuallyHidden &&
          style.textOverflow !== 'ellipsis' &&
          element.getBoundingClientRect().width > 1 &&
          element.scrollWidth > element.clientWidth + 1
        );
      })
      .map((element) => {
        const name = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''} "${name}": ${element.scrollWidth}px of content in ${element.clientWidth}px`;
      }),
  );
  expect(clipped).toEqual([]);
}

/**
 * Checks that every field's placeholder fits inside the field, measured in the
 * field's own font: a longer one is cut off mid-word ("Zoek op naam of e").
 *
 * @param page - The browser page.
 */
async function expectPlaceholdersFit(page: Page): Promise<void> {
  const cutOff = await page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d');
    if (!canvas) {
      return ['no canvas to measure with'];
    }
    return [...document.querySelectorAll('input[placeholder], textarea[placeholder]')]
      .filter((field) => field.getClientRects().length > 0)
      .filter((field) => {
        const style = getComputedStyle(field);
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        // From the outer width: browsers differ in whether a field's clientWidth counts padding.
        const room =
          field.getBoundingClientRect().width -
          ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
            .map((side) =>
              Number.parseFloat(
                style.getPropertyValue(
                  side.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
                ),
              ),
            )
            .reduce((sum, width) => sum + width, 0);
        return canvas.measureText(field.getAttribute('placeholder') ?? '').width > room + 1;
      })
      .map((field) => field.getAttribute('placeholder'));
  });
  expect(cutOff).toEqual([]);
}

/**
 * Checks that the page doesn't scroll sideways or cut anything off once it
 * has loaded (see {@link expectFitsNow}, {@link expectNothingClipped} and
 * {@link expectPlaceholdersFit}).
 *
 * @param page - The browser page.
 */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expectFitsNow(page);
  await expectNothingClipped(page);
  await expectPlaceholdersFit(page);
}

/**
 * Checks that every field people type in has text of at least 16px: iOS
 * Safari zooms the page in when a field with smaller text gets focus. Hidden
 * fields and those kept from assistive technology (like the native select
 * behind a Radix select) can't get focus, so they don't count.
 *
 * @param page - The browser page, loaded.
 */
async function expectFieldsDontZoom(page: Page): Promise<void> {
  const smallFields = await page.evaluate(() => {
    const notTyped = ['hidden', 'checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'range'];
    return [...document.querySelectorAll('input, textarea, select')]
      .filter(
        (field) =>
          !notTyped.includes(field.getAttribute('type') ?? '') &&
          field.getClientRects().length > 0 &&
          field.closest('[aria-hidden="true"]') === null,
      )
      .map((field) => ({
        field: field.getAttribute('name') ?? field.getAttribute('aria-label') ?? field.id,
        fontSize: getComputedStyle(field).fontSize,
      }))
      .filter(({ fontSize }) => Number.parseFloat(fontSize) < 16);
  });
  expect(smallFields).toEqual([]);
}

/**
 * The sign-in page's button for the other way in, per language: the longest
 * label on the page, which gets the "Last used" badge after a sign-in by link.
 */
const USE_LINK_BUTTON = {
  'en-US': 'Sign in with an email link instead',
  'nl-NL': 'Liever inloggen met een e-maillink',
  'es-ES': 'Usar un enlace por correo',
} as const;

/**
 * Checks the sign-in page fits with its widest buttons: the email link button
 * with the "Last used" badge, then the link form's send button with it. Their
 * labels wrap rather than make the page scroll sideways.
 *
 * @param context - The browser context, which gets the "Last used" cookie.
 * @param page - The browser page.
 * @param locale - The page's language.
 */
async function expectSignInFitsWithLastUsed(
  context: BrowserContext,
  page: Page,
  locale: keyof typeof USE_LINK_BUTTON,
): Promise<void> {
  await context.addCookies([
    { name: LAST_USED_LOGIN_METHOD_COOKIE, value: 'magic-link', url: E2E_BASE_URL },
  ]);
  await page.goto('/auth');
  await expectNoSidewaysScroll(page);
  await page.getByRole('button', { name: USE_LINK_BUTTON[locale] }).click();
  await expect(page.getByRole('button', { name: USE_LINK_BUTTON[locale] })).toHaveCount(0);
  await expectNoSidewaysScroll(page);
}

test.describe('on a 320px wide screen', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the sign-in page fits with "Last used" on its longest buttons', async ({
    context,
    page,
  }) => {
    await expectSignInFitsWithLastUsed(context, page, 'en-US');
  });

  PUBLIC_PATHS.forEach((path) => {
    test(`${path} fits without sideways scrolling or zooming into its fields`, async ({ page }) => {
      await page.goto(path);
      await expectNoSidewaysScroll(page);
      await expectFieldsDontZoom(page);
    });
  });

  test('a sign-in link page that names the account fits without sideways scrolling', async ({
    page,
  }) => {
    await page.goto(await storeSignInLink(getTestDatabaseUrl(), CLIENT_WATCHER.email));
    await expectNoSidewaysScroll(page);
  });

  ['/auth', '/sign-in-error?error=state_mismatch'].forEach((path) => {
    test(`${path}: the theme and language button covers no other control`, async ({ page }) => {
      await page.goto(path);
      const covered = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((element) =>
          element.getAttribute('aria-label')?.startsWith('Theme and language'),
        );
        if (!button) {
          return ['no theme and language button'];
        }
        const box = button.getBoundingClientRect();
        return [...document.querySelectorAll('a[href], button, input, select, textarea')]
          .filter((element) => element !== button)
          .filter((element) => {
            const other = element.getBoundingClientRect();
            return (
              other.width > 0 &&
              other.left < box.right &&
              other.right > box.left &&
              other.top < box.bottom &&
              other.bottom > box.top
            );
          })
          .map((element) => (element.textContent ?? '').trim() || element.tagName);
      });
      expect(covered).toEqual([]);
    });
  });

  test('the companies list shows each status under the name', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: adminState,
      viewport: { width: 320, height: 640 },
    });
    const page = await context.newPage();
    await page.goto('/admin/companies');
    // Once the list is there: no Status column squeezing the names, the badge sits under the name.
    await expect(page.getByRole('columnheader', { name: 'Company' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeHidden();
    const nameCell = page
      .getByRole('row')
      .filter({ hasText: COMPANY_NAME })
      .getByRole('cell')
      .first();
    await expect(
      nameCell.getByText('Active', { exact: true }).filter({ visible: true }),
    ).toHaveCount(1);
    await context.close();
  });

  test('the Sort menu keeps clear of the screen edges', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: adminState,
      viewport: { width: 320, height: 640 },
    });
    const page = await context.newPage();
    await page.goto('/admin/users');
    await page.getByRole('button', { name: /^Sort users/ }).click();
    const box = defined(await page.getByRole('menu').boundingBox(), 'the menu');
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(320 - 16);
    await context.close();
  });

  APP_PATHS.forEach((path) => {
    test(`${path} fits without sideways scrolling or zooming into its fields`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: adminState,
        viewport: { width: 320, height: 640 },
      });
      const page = await context.newPage();
      await page.goto(resolvePath(path));
      await expectNoSidewaysScroll(page);
      await expectFieldsDontZoom(page);
      await context.close();
    });

    test(`${path} fits without sideways scrolling while it loads`, async ({ browser }) => {
      // Without JavaScript the streamed content never replaces the Suspense placeholders, so the
      // page stays as it looks while it loads.
      const context = await browser.newContext({
        storageState: adminState,
        viewport: { width: 320, height: 640 },
        javaScriptEnabled: false,
      });
      const page = await context.newPage();
      await page.goto(resolvePath(path));
      await expectFitsNow(page);
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
      await page.getByRole('button', { name: /^Theme and language:/ }).click();
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

/**
 * Dutch and Spanish run about a third longer than English, so every page is
 * scanned in both, on a 320px wide screen where longer words would overflow
 * first. Colours don't depend on the language, so light mode covers it.
 */
(['nl-NL', 'es-ES'] as const).forEach((locale) => {
  test.describe(`in ${locale}, on a 320px wide screen`, () => {
    test.use({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce' });

    /** The language cookie, which every page reads its language from. */
    const languageCookie = { name: 'adiutor.locale', value: locale, url: E2E_BASE_URL };

    PUBLIC_PATHS.forEach((path) => {
      test(`${path} signed out`, async ({ context, page }) => {
        await context.addCookies([languageCookie]);
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expectNoSidewaysScroll(page);
        await expectAccessible(page);
      });
    });

    APP_PATHS.forEach((path) => {
      test(path, async ({ browser }) => {
        const context = await browser.newContext({
          storageState: adminState,
          viewport: { width: 320, height: 640 },
          reducedMotion: 'reduce',
        });
        // Over the cookie the Admin's sign-in set, which says English.
        await context.addCookies([languageCookie]);
        const page = await context.newPage();
        await page.goto(resolvePath(path));
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expectNoSidewaysScroll(page);
        await expectAccessible(page);
        await context.close();
      });
    });

    test('the sign-in page fits with "Last used" on its longest buttons', async ({
      context,
      page,
    }) => {
      await context.addCookies([languageCookie]);
      await expectSignInFitsWithLastUsed(context, page, locale);
    });

    test('the theme and language menu, signed out', async ({ context, page }) => {
      await context.addCookies([languageCookie]);
      await page.goto('/auth');
      await page.getByRole('button', { name: /^(Thema en taal|Tema e idioma):/ }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, '[role="menu"]');
    });
  });
});
