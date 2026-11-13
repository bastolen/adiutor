/**
 * @file Shared steps for the end-to-end tests: signing in and out, the
 * authenticator and sign-in link steps, a signed-in Admin's cookies for specs
 * that only read, signing in as a user, and steps on the staff screens that
 * more than one spec uses.
 */
import { randomInt, randomUUID } from 'node:crypto';

import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import { PLATFORM_ADMIN } from './fixtures';
import { codeForSecret, codeForSetupKey } from './totp';

/** How long Better Auth's sign-in rate limit window lasts (3 attempts per 10 seconds). */
const RATE_LIMIT_WINDOW_MS = 10_000;

/**
 * A fresh address for a test's own account or invitation, unique per call
 * (an address may have only one open invitation per company).
 *
 * @param prefix - What the address is for.
 * @returns The address, on the test domain.
 */
export function freshAddress(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@adiutor.test`;
}

/**
 * A random client IP address (from the documentation range 198.51.100.0/24),
 * to send as `X-Forwarded-For`.
 *
 * @returns The address.
 */
export function randomClientIp(): string {
  return `198.51.100.${randomInt(1, 255)}`;
}

/**
 * Gives the page's requests another client IP of their own. Each test already
 * gets its own address (`e2e/support/test.ts`); this is for a test that signs
 * in on several pages, so Better Auth's per-IP limits (3 sign-ins per 10
 * seconds, sign-in links, codes) aren't shared between them.
 *
 * @param page - The browser page.
 */
export async function useOwnClientIp(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': randomClientIp() });
}

/**
 * The toasts the signed-in app reports results in (every success, and every
 * error next to its inline message), in their "Notifications (F8)" region.
 *
 * @param page - The browser page.
 * @returns The region.
 */
export function toasts(page: Page): Locator {
  return page.getByRole('region', { name: /^Notifications/ });
}

/** Pages a signed-in user can land on. */
const SIGNED_IN_URL = /\/(dashboard|companies\/|account)/;

/**
 * Enters the current authenticator code on the code step, waiting out the
 * rate limit like {@link signIn} does.
 *
 * @param page - The browser page, on `/auth/two-factor`.
 * @param totpSecret - The account's raw authenticator secret.
 * @param attempt - Which attempt this is (used for retries).
 */
async function enterAuthenticatorCode(page: Page, totpSecret: string, attempt = 1): Promise<void> {
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill(codeForSecret(totpSecret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  const rateLimited = page.getByRole('alert').filter({ hasText: 'Too many requests' });
  await expect
    .poll(async () => SIGNED_IN_URL.test(page.url()) || rateLimited.isVisible())
    .toBe(true);
  if (!SIGNED_IN_URL.test(page.url()) && attempt < 3) {
    // eslint-disable-next-line no-restricted-properties -- Waits out Better Auth's rate-limit window.
    await page.waitForTimeout(RATE_LIMIT_WINDOW_MS);
    await enterAuthenticatorCode(page, totpSecret, attempt + 1);
    return;
  }
  await expect(page).toHaveURL(SIGNED_IN_URL);
}

/**
 * Submits the password sign-in form and waits for the result: the app or the
 * code step. The tests run against a production build, where Better Auth
 * limits sign-ins to 3 per 10 seconds per address. Each test has its own
 * address, so only a test that signs in more often than that on one page hits
 * the limit; then this waits for the window to pass and tries again.
 *
 * @param page - The browser page.
 * @param account - The account to sign in with.
 * @param account.email - Email address.
 * @param account.password - Password.
 * @param from - The sign-in page to start on, e.g. with a `callbackURL`.
 * @param attempt - Which attempt this is (used for retries).
 * @returns `code-step` when the code step is showing, otherwise `signed-in`.
 */
export async function submitPassword(
  page: Page,
  account: { email: string; password: string },
  from = '/auth',
  attempt = 1,
): Promise<'code-step' | 'signed-in'> {
  await page.goto(from);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  /**
   * Whether the code step is showing.
   *
   * @returns Whether the page is the code step.
   */
  const onCodeStep = () => page.url().includes('/auth/two-factor');
  const rateLimited = page.getByRole('alert').filter({ hasText: 'Too many requests' });
  await expect
    .poll(async () => SIGNED_IN_URL.test(page.url()) || onCodeStep() || rateLimited.isVisible())
    .toBe(true);

  if (onCodeStep()) {
    return 'code-step';
  }
  if (SIGNED_IN_URL.test(page.url())) {
    return 'signed-in';
  }
  if (attempt >= 3) {
    throw new Error(`Signing in as ${account.email} kept hitting the rate limit.`);
  }
  // eslint-disable-next-line no-restricted-properties -- Waits out Better Auth's rate-limit window.
  await page.waitForTimeout(RATE_LIMIT_WINDOW_MS);
  return submitPassword(page, account, from, attempt + 1);
}

/**
 * Signs in with email and password, completing the code step with a
 * computed authenticator code for accounts that have one.
 *
 * @param page - The browser page.
 * @param account - The account to sign in with.
 * @param account.email - Email address.
 * @param account.password - Password.
 * @param account.totpSecret - Raw authenticator secret, for accounts with two-step verification.
 */
export async function signIn(
  page: Page,
  account: { email: string; password: string; totpSecret?: string },
): Promise<void> {
  if ((await submitPassword(page, account)) === 'code-step') {
    if (!account.totpSecret) {
      throw new Error(`${account.email} has two-step verification on; sign in by hand.`);
    }
    await enterAuthenticatorCode(page, account.totpSecret);
  }
  await expect(page).toHaveURL(SIGNED_IN_URL);
}

/**
 * Creates an account from an open invitation page.
 *
 * @param page - The browser page, on `/invite/…`.
 * @param name - The new account's name.
 * @param password - Its password.
 * @param landsOn - Where they should end up: the company page, or the
 *   Security page for a company Admin, who must set up MFA first.
 */
export async function createAccountFromInvitation(
  page: Page,
  name: string,
  password: string,
  landsOn: string | RegExp = /\/companies\/[0-9a-f-]{36}$/,
) {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page).toHaveURL(landsOn);
}

/**
 * Sets up an authenticator app on the Security page, as the user would
 * with their phone, and saves the backup codes.
 *
 * @param page - The browser page, on the Security page.
 * @param password - The user's password, to confirm the change.
 * @returns One of the backup codes.
 */
export async function setUpAuthenticator(page: Page, password: string): Promise<string> {
  await page.getByRole('button', { name: 'Use an authenticator app' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up an authenticator app' });
  await dialog.getByLabel('Current password').fill(password);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('img', { name: /QR code/ })).toBeVisible();
  const setupKey = (await dialog.locator('code').textContent()) ?? '';
  await dialog.getByRole('textbox', { name: 'Code', exact: true }).fill(codeForSetupKey(setupKey));
  await dialog.getByRole('button', { name: 'Turn on' }).click();

  const codes = page.getByRole('dialog', { name: 'Save your backup codes' });
  const backupCode = (await codes.getByRole('listitem').first().textContent())?.trim() ?? '';
  expect(backupCode).not.toBe('');
  await codes.getByRole('button', { name: "I've saved these codes" }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  return backupCode;
}

/**
 * Signs out through the account menu.
 *
 * @param page - The browser page, on an app page.
 */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth/);
}

/**
 * Opens the Profile page of the account through the account menu, as the
 * user would: a click on a link, without loading the page, so a page Next
 * kept alive from earlier comes back.
 *
 * @param page - The browser page, on an app page.
 */
export async function openAccountSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Account settings' }).click();
  await expect(page).toHaveURL('/account');
}

/**
 * Opens a sign-in link from an email and continues on its confirmation page,
 * as the user would (the link itself only shows that page, see
 * `src/lib/sign-in/email-link.ts`).
 *
 * @param page - The browser page.
 * @param url - The link from the email.
 */
export async function openSignInLink(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByRole('button', { name: 'Continue signing in' }).click();
}

/** The cookies and local storage of a signed-in browser context. */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Signs the staff Admin in once, for specs that only read as the Admin
 * (scans, keyboard checks, tables): they open each test's context with the
 * returned state instead of signing in again, which the sign-in rate limits
 * would slow down.
 *
 * @param browser - The browser.
 * @param whileSignedIn - Optional steps to run on the signed-in page first, e.g. looking up an
 *   ID in the Admin's screens.
 * @returns The Admin's sign-in cookies.
 */
export async function adminStorageState(
  browser: Browser,
  whileSignedIn?: (page: Page) => Promise<void>,
): Promise<StorageState> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // As `useOwnClientIp` does, inlined because its name makes the hooks lint rule object here.
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': randomClientIp() });
    await signIn(page, PLATFORM_ADMIN);
    await whileSignedIn?.(page);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/**
 * Opens a user's detail page from the users list.
 *
 * @param page - The browser page, signed in as staff.
 * @param name - The user's display name.
 */
export async function openUser(page: Page, name: string): Promise<void> {
  await page.goto(`/admin/users?q=${encodeURIComponent(name)}`);
  await page.getByRole('main').getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/**
 * Signs in as a user from their detail page's "Sign in as user" card, with a
 * reason, and waits for the banner where the user lands. The staff member
 * must have confirmed with a strong second step lately (a sign-in with an
 * authenticator code counts).
 *
 * @param page - The browser page, signed in as staff who may sign in as the user.
 * @param name - The user's display name.
 * @param options - Options.
 * @param options.reason - Why, as typed into the dialog; none by default.
 * @param options.landsOn - Where the user lands: the dashboard, or the Security page for a role
 *   that must set up MFA first.
 */
export async function signInAsUser(
  page: Page,
  name: string,
  { reason = '', landsOn = '/dashboard' }: { reason?: string; landsOn?: string } = {},
): Promise<void> {
  await openUser(page, name);
  await page.getByRole('button', { name: 'Sign in as user' }).click();
  const dialog = page.getByRole('dialog', { name: `Sign in as ${name}?` });
  await dialog.getByLabel('Reason (optional)').fill(reason);
  await dialog.getByRole('button', { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL(landsOn);
  await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toBeVisible();
}

/**
 * Creates an invite link with the form on the Members page of a company or
 * the Staff page.
 *
 * @param page - The browser page, signed in and on the Members or Staff page.
 * @param role - The role's name in the menu, e.g. "Client".
 * @returns The link.
 */
export async function createInviteLink(page: Page, role: string): Promise<string> {
  const linkForm = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Create invite link' }) });
  await linkForm.getByRole('combobox', { name: 'Role', exact: true }).click();
  // Each option's name also holds its description ("Admin Raises requests …").
  await page.getByRole('option', { name: new RegExp(`^${role}\\b`) }).click();
  await linkForm.getByRole('button', { name: 'Create invite link' }).click();
  return page.getByRole('textbox', { name: 'Invite link' }).inputValue();
}
