/**
 * @file End-to-end tests for signed-out behaviour of the auth pages: signing
 * in goes on to the card a signed-out visitor's address named, the sign-in
 * page sends someone who is signed in already on, signing out leaves nothing
 * behind in the browser (signing out and in load the next page afresh, so no
 * page Next keeps alive is left for the next person, also in the browser's
 * other tabs, after an email link too), and the sign-in page shows its
 * "Last used" hint.
 */

import { LOCALE_COOKIE } from '../src/lib/i18n/locales';
import { LAST_USED_LOGIN_METHOD_COOKIE } from '../src/lib/sign-in/auth-cookies';
import { PROVIDER_LINKED_COOKIE } from '../src/lib/sign-in/oauth-providers';
import { storeSignInLink } from './support/db';
import { CLIENT_WATCHER, SESSIONS_CLIENT, STAFF_NAME, SUPPORT_STAFF } from './support/fixtures';
import {
  fillAndSubmitSignIn,
  openAccountSettings,
  openSignInLink,
  signIn,
  signOut,
  submitPassword,
  APP_HOME_URL,
} from './support/helpers';
import { expect, test } from './support/test';
import { codeForSecret } from './support/totp';

test('a signed-out visitor of the dashboard is sent to sign in', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL('/auth?callbackURL=%2Fdashboard');
  await expect(page.getByRole('heading', { name: `Sign in to ${STAFF_NAME}` })).toBeVisible();
});

test('signing in goes on to the card the address named', async ({ page }) => {
  // The proxy can't see the anchor, but the browser keeps it on the sign-in page's address.
  expect(await submitPassword(page, CLIENT_WATCHER, '/account/security#password')).toBe(
    'signed-in',
  );

  await expect(page).toHaveURL('/account/security#password');
  await expect(page.getByRole('heading', { name: 'Password', exact: true })).toBeFocused();
});

test('the sign-in page links to password reset', async ({ page }) => {
  await page.goto('/auth');
  await page.getByRole('link', { name: 'Forgot password?' }).click();

  await expect(page).toHaveURL('/auth/forgot-password');
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
});

test('a reset link without a token explains what to do', async ({ page }) => {
  await page.goto('/auth/reset-password');

  // Filter by text: Next.js's route announcer also has role="alert".
  await expect(
    page.getByRole('alert').filter({ hasText: 'This reset link is incomplete.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
});

test('the sign-in page sends someone signed in already on to the page they asked for', async ({
  page,
}) => {
  await signIn(page, CLIENT_WATCHER);

  await page.goto('/auth?callbackURL=%2Faccount');
  await expect(page).toHaveURL('/account');
  await page.goto('/auth');
  await expect(page).toHaveURL('/dashboard');
  // Only to pages of the app, and never back to the sign-in page.
  await page.goto('/auth?callbackURL=https%3A%2F%2Fevil.adiutor.test');
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/auth?callbackURL=%2Fauth%3FcallbackURL%3D%252Faccount');
  await expect(page).toHaveURL('/dashboard');
});

test('the sign-in form is empty after signing out, for the next person to sign in', async ({
  page,
}) => {
  await signIn(page, CLIENT_WATCHER);

  await signOut(page);
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByLabel('Password')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();

  // And the next person can sign in straight away.
  await fillAndSubmitSignIn(page, CLIENT_WATCHER);
  await expect(page).toHaveURL(APP_HOME_URL);
});

test('the next person to sign in on this browser sees their own account, not the last one’s', async ({
  page,
}) => {
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await signIn(page, CLIENT_WATCHER);
  // Opened with a click, so Next would keep it alive with the Watcher's name in its field.
  await openAccountSettings(page);
  await expect(name).toHaveValue(CLIENT_WATCHER.name);
  await signOut(page);

  // Someone else signs in on the same page, without loading it again.
  await fillAndSubmitSignIn(page, SUPPORT_STAFF);
  await expect(page).toHaveURL('/dashboard');
  await openAccountSettings(page);
  await expect(name).toHaveValue(SUPPORT_STAFF.name);
});

test("signing in or out in one tab loads the browser's other tabs afresh", async ({
  page,
  context,
}) => {
  // A second tab of the same browser is on the sign-in page too.
  const other = await context.newPage();
  await other.goto('/auth');
  await expect(other.getByRole('heading', { name: `Sign in to ${STAFF_NAME}` })).toBeVisible();

  // Signing in in the first tab takes the other one on without a click, signed in.
  await signIn(page, CLIENT_WATCHER);
  await expect(other).toHaveURL(APP_HOME_URL);

  // The other tab's Profile page, opened with a click, so Next would keep it alive with the name.
  const otherName = other.getByRole('textbox', { name: 'Name', exact: true });
  await openAccountSettings(other);
  await expect(otherName).toHaveValue(CLIENT_WATCHER.name);

  // Signing out in the first tab sends the other one to the sign-in page, which comes back there.
  await signOut(page);
  await expect(other).toHaveURL('/auth?callbackURL=%2Faccount');
  await expect(other.getByRole('heading', { name: `Sign in to ${STAFF_NAME}` })).toBeVisible();
  await expect(otherName).toHaveCount(0);
});

test("an email-link sign-in loads the browser's other tabs afresh", async ({ page, context }) => {
  // A second tab of the same browser is on the sign-in page.
  const other = await context.newPage();
  await other.goto('/auth');
  await expect(other.getByRole('heading', { name: `Sign in to ${STAFF_NAME}` })).toBeVisible();

  // The link comes back through a redirect, so the page it lands on tells the other tab, which goes
  // on without a click, signed in.
  await openSignInLink(page, await storeSignInLink(CLIENT_WATCHER.email));
  await expect(page).toHaveURL(APP_HOME_URL);
  await expect(other).toHaveURL(APP_HOME_URL);
});

test('the code step starts over after signing out, with "Trust this device" unticked', async ({
  page,
}) => {
  /**
   * Signs in with the password, up to the code step.
   */
  const passwordStep = async () => {
    await fillAndSubmitSignIn(page, SESSIONS_CLIENT);
    await expect(page).toHaveURL(/\/auth\/two-factor/);
  };
  const code = page.getByRole('textbox', { name: 'Code', exact: true });
  const trust = page.getByRole('checkbox', {
    name: 'Trust this device (until 30 days after your last password sign-in here)',
  });

  await page.goto('/auth');
  await passwordStep();
  await trust.check();
  await code.fill(codeForSecret(SESSIONS_CLIENT.totpSecret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(APP_HOME_URL);

  // Signing out forgets the trusted device, so the code step comes back, and it starts over: the
  // next person mustn't trust this browser for the previous user without noticing.
  await signOut(page);
  await passwordStep();
  await expect(code).toHaveValue('');
  await expect(trust).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Verify and sign in' })).toBeEnabled();
});

/** The cookie Better Auth sets with a passkey challenge (the sign-in page asks for one on load). */
const PASSKEY_CHALLENGE_COOKIE = 'better-auth.better-auth-passkey';

test('signing out clears the cache and leaves only the "Last used" sign-in method and the language, which the sign-in page marks', async ({
  page,
  context,
}) => {
  await signIn(page, CLIENT_WATCHER);
  // A cookie of the app's own, as the provider-linked notice sets one, and a language of the
  // browser's own, as choosing one sets (the seeded account is on Default, so sign-in sets none).
  await context.addCookies([
    { name: PROVIDER_LINKED_COOKIE, value: 'github', url: page.url() },
    { name: LOCALE_COOKIE, value: 'en-US', url: page.url() },
  ]);

  const signedOut = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/sign-out'),
  );
  await signOut(page);

  // The browser drops what it kept (the attached files it checks with the server before each use).
  expect(await (await signedOut).headerValue('clear-site-data')).toBe('"cache"');

  // The sign-in page it lands on asks for a passkey challenge right away (for passkey autofill),
  // which sets a new short-lived cookie of its own; everything from before is gone.
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names.filter((name) => name !== PASSKEY_CHALLENGE_COOKIE).sort()).toEqual(
    [LAST_USED_LOGIN_METHOD_COOKIE, LOCALE_COOKIE].sort(),
  );
  // The method used last, the password, is marked for sighted readers and screen readers; the
  // passkey button isn't.
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toContainText(
    'Last used',
  );
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toHaveAccessibleDescription('Last used');
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).not.toContainText(
    'Last used',
  );
});
