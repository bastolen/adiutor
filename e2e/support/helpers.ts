/**
 * @file Shared steps for the end-to-end tests: signing in and out, the
 * authenticator and sign-in link steps, a signed-in Admin's cookies for specs
 * that only read, signing in as a user, searching a long select, and steps on
 * the staff screens that more than one spec uses.
 */
import { randomInt, randomUUID } from 'node:crypto';

import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import { E2E_BASE_URL, PLATFORM_ADMIN } from './fixtures';
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
 * A random client IP address, to send as `X-Forwarded-For`: one of about
 * 130,000 in 198.18.0.0/15, the block set aside for testing (RFC 2544).
 * Better Auth counts its limits per address, and its window only starts
 * again after 10 seconds without a request from that address, so an address
 * a test used moments earlier would carry its count over. With this many,
 * tests close together practically never share one.
 *
 * @returns The address.
 */
export function randomClientIp(): string {
  return `198.${randomInt(18, 20)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
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
 * The editor of a Markdown field (a request's description, a reply), once it
 * has taken the place of the plain text field the page starts with.
 *
 * @param page - The browser page.
 * @param name - The field's label.
 * @returns The editor.
 */
export async function markdownEditor(page: Page, name: string): Promise<Locator> {
  const editor = page.getByRole('textbox', { name });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  return editor;
}

/**
 * The toasts the signed-in app reports results in (every success, and every
 * error next to its inline message, except one an open dialog shows), in
 * their "Notifications (F8)" region, which is named in the reader's language
 * ("Meldingen (F8)", "Notificaciones (F8)").
 *
 * @param page - The browser page.
 * @returns The region.
 */
export function toasts(page: Page): Locator {
  return page.getByRole('region', { name: /^(Notifications|Meldingen|Notificaciones) \(F8\)$/ });
}

/** A transparent 1×1 PNG, for pictures the browser is answered with. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Answers every request for a person's picture (`/avatars/*`) in the
 * browser with a tiny PNG, so no test makes Adiutor fetch it from GitHub or
 * Google.
 *
 * @param page - The browser page.
 */
export async function answerPictures(page: Page): Promise<void> {
  await page.route('**/avatars/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG }),
  );
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
 * Fills the email and password on the sign-in form and clicks Sign in,
 * without waiting for the result.
 *
 * @param page - The browser page, on the sign-in page.
 * @param account - The account to sign in with.
 * @param account.email - Email address.
 * @param account.password - Password.
 */
export async function fillAndSubmitSignIn(
  page: Page,
  account: { email: string; password: string },
): Promise<void> {
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
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
  await fillAndSubmitSignIn(page, account);

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
 * Confirms it's the user on the "Confirm it's you" page: fills the current
 * authenticator code and presses Confirm.
 *
 * @param page - The browser page, on the confirmation page (`/auth/verify`).
 * @param totpSecret - The account's raw authenticator secret.
 */
export async function confirmWithAuthenticator(page: Page, totpSecret: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill(codeForSecret(totpSecret));
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
}

/**
 * Creates an account from an open invitation page, and waits until the page
 * it lands on has loaded afresh: the browser acts as someone new, so that
 * page loads a second time (`ReloadWhenActingAsChanges`), which would
 * interrupt a navigation the test starts in between.
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
  // The action's redirect is a navigation within the app; the fresh load after it is the full one.
  const loadedAfresh = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page).toHaveURL(landsOn);
  await loadedAfresh;
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

/**
 * Opens a link from an email the way a click in a webmail tab does: a
 * navigation a person made from another site (`Sec-Fetch-Site: cross-site`,
 * `Sec-Fetch-User: ?1`), which the link in an email about a request needs to
 * sign in straight away (`isPersonsClick`, decision 0036).
 *
 * @param page - The browser page.
 * @param url - The link, absolute or a path on the test server.
 */
export async function clickLinkInEmail(page: Page, url: string): Promise<void> {
  const href = new URL(url, E2E_BASE_URL).toString();
  await page.goto('about:blank');
  await page.setContent(`<a href="${href.replaceAll('"', '&quot;')}">Open the request</a>`);
  await page.getByRole('link', { name: 'Open the request' }).click();
  await page.waitForURL((current) => current.origin === new URL(E2E_BASE_URL).origin);
}

/** The cookies and local storage of a signed-in browser context. */
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/**
 * Signs an account in once, for specs that only read as it (scans, keyboard
 * checks, tables): they open each test's context with the returned state
 * instead of signing in again, which the sign-in rate limits would slow
 * down.
 *
 * @param browser - The browser.
 * @param account - The account to sign in as.
 * @param whileSignedIn - Optional steps to run on the signed-in page first, e.g. looking up an
 *   ID in the account's screens.
 * @returns The account's sign-in cookies.
 */
export async function storageStateFor(
  browser: Browser,
  account: Parameters<typeof signIn>[1],
  whileSignedIn?: (page: Page) => Promise<void>,
): Promise<StorageState> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // As `useOwnClientIp` does, inlined because its name makes the hooks lint rule object here.
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': randomClientIp() });
    await signIn(page, account);
    await whileSignedIn?.(page);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/**
 * Signs the staff Admin in once ({@link storageStateFor}), for specs that
 * only read as the Admin.
 *
 * @param browser - The browser.
 * @param whileSignedIn - Optional steps to run on the signed-in page first, e.g. looking up an
 *   ID in the Admin's screens.
 * @returns The Admin's sign-in cookies.
 */
export function adminStorageState(
  browser: Browser,
  whileSignedIn?: (page: Page) => Promise<void>,
): Promise<StorageState> {
  return storageStateFor(browser, PLATFORM_ADMIN, whileSignedIn);
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
 * Chooses a tab of the user's page that's open (Overview, Companies,
 * Activity or Manage), and waits until it's the current one.
 *
 * @param page - The browser page, on a user's page.
 * @param tab - The tab's name.
 */
export async function chooseUserTab(
  page: Page,
  tab: 'Overview' | 'Companies' | 'Activity' | 'Manage',
): Promise<void> {
  const link = page
    .getByRole('navigation', { name: 'User sections' })
    .getByRole('link', { name: tab, exact: true });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
}

/**
 * Opens a tab of a user's page from the users list.
 *
 * @param page - The browser page, signed in as staff.
 * @param name - The user's display name.
 * @param tab - The tab's name.
 */
export async function openUserTab(
  page: Page,
  name: string,
  tab: 'Companies' | 'Activity' | 'Manage',
): Promise<void> {
  await openUser(page, name);
  await chooseUserTab(page, tab);
}

/**
 * Signs in as a user from the "Sign in as user" card on their page's Manage tab, with a
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
  await openUserTab(page, name, 'Manage');
  await page.getByRole('button', { name: 'Sign in as user' }).click();
  const dialog = page.getByRole('dialog', { name: `Sign in as ${name}?` });
  await dialog.getByLabel('Reason (optional)').fill(reason);
  await dialog.getByRole('button', { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL(landsOn);
  await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toBeVisible();
}

/**
 * Searches a long select (one with more options than its search threshold)
 * by typing on it, as people do: the first character opens it with that
 * character in its search, and the rest are typed into the search field,
 * which has the focus. The first one is retried, because right after a
 * (re)load the page may still be hydrating and ignore it.
 *
 * @param select - The select's combobox: the closed field.
 * @param typed - What to type, at least one character.
 * @returns The open panel, with the search field and the list of what matches.
 */
export async function searchSelect(select: Locator, typed: string): Promise<Locator> {
  const page = select.page();
  const panel = page.locator(`[id="${await select.getAttribute('aria-controls')}"]`);
  await expect(async () => {
    if ((await panel.count()) === 0) {
      await select.press(typed.charAt(0));
    }
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  const search = panel.getByRole('combobox');
  await expect(search).toBeFocused();
  await page.keyboard.type(typed.slice(1));
  await expect(search).toHaveValue(typed);
  return panel;
}

/**
 * Creates an invite link with the form on the Members page of a company or
 * in the staff settings.
 *
 * @param page - The browser page, signed in and on the Members page or the staff settings.
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

/**
 * Sends an invitation with the form on the Members page of a company or in
 * the staff settings, without waiting for the result.
 *
 * @param page - The browser page, signed in and on the Members page or the staff settings.
 * @param email - The address to invite.
 * @param role - The role's name in the menu, e.g. "Client".
 */
export async function sendInvitation(page: Page, email: string, role: string): Promise<void> {
  const inviteForm = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Send invitations' }) });
  await inviteForm.getByLabel('Email addresses').fill(email);
  await inviteForm.getByRole('combobox', { name: 'Role', exact: true }).click();
  // Each option's name also holds its description ("Client Raises requests …").
  await page.getByRole('option', { name: new RegExp(`^${role}\\b`) }).click();
  await inviteForm.getByRole('button', { name: 'Send invitations' }).click();
}
