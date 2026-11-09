/**
 * @file End-to-end tests for signed-out behaviour of the auth pages: signing
 * in goes on to the card a signed-out visitor's address named, the sign-in
 * page sends someone who is signed in already on, signing out leaves nothing
 * behind in the browser (including the sign-in pages Next keeps alive, which
 * must start over), and the sign-in page shows its "Last used" hint.
 */

import { CLIENT_WATCHER, SESSIONS_CLIENT } from './support/fixtures';
import { signIn, signOut, submitPassword, useOwnClientIp } from './support/helpers';
import { expect, test } from './support/test';
import { codeForSecret } from './support/totp';
import { LAST_USED_LOGIN_METHOD_COOKIE } from '../src/lib/sign-in/auth-cookies';
import { PROVIDER_LINKED_COOKIE } from '../src/lib/sign-in/oauth-providers';

test('a signed-out visitor of the dashboard is sent to sign in', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL('/auth?callbackURL=%2Fdashboard');
  await expect(page.getByRole('heading', { name: 'Sign in to Adiutor' })).toBeVisible();
});

test('signing in goes on to the card the address named', async ({ page }) => {
  await useOwnClientIp(page);
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
  await useOwnClientIp(page);
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

test('the sign-in form starts over after signing out, without reloading the page', async ({
  page,
}) => {
  await useOwnClientIp(page);
  await signIn(page, CLIENT_WATCHER);

  // Signing out goes back to the sign-in page Next kept alive since signing in.
  await signOut(page);
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByLabel('Password')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();

  // And the next person can sign in straight away.
  await page.getByLabel('Email').fill(CLIENT_WATCHER.email);
  await page.getByLabel('Password').fill(CLIENT_WATCHER.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/(dashboard|companies\/)/);
});

test('the code step starts over after signing out, with "Trust this device" unticked', async ({
  page,
}) => {
  await useOwnClientIp(page);
  /**
   * Signs in with the password, up to the code step.
   */
  const passwordStep = async () => {
    await page.getByLabel('Email').fill(SESSIONS_CLIENT.email);
    await page.getByLabel('Password').fill(SESSIONS_CLIENT.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/two-factor/);
  };
  const code = page.getByRole('textbox', { name: 'Code', exact: true });
  const trust = page.getByRole('checkbox', { name: 'Trust this device for 30 days' });

  await page.goto('/auth');
  await passwordStep();
  await trust.check();
  await code.fill(codeForSecret(SESSIONS_CLIENT.totpSecret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/(dashboard|companies\/)/);

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

test('signing out leaves only the "Last used" sign-in method and the language in the browser', async ({
  page,
  context,
}) => {
  await useOwnClientIp(page);
  await signIn(page, CLIENT_WATCHER);
  // A cookie of the app's own, as the provider-linked notice sets one, and a language of the
  // browser's own, as choosing one sets (the seeded account is on Default, so sign-in sets none).
  await context.addCookies([
    { name: PROVIDER_LINKED_COOKIE, value: 'github', url: page.url() },
    { name: 'adiutor.locale', value: 'en-US', url: page.url() },
  ]);

  await signOut(page);

  // The sign-in page it lands on asks for a passkey challenge right away (for passkey autofill),
  // which sets a new short-lived cookie of its own; everything from before is gone.
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names.filter((name) => name !== PASSKEY_CHALLENGE_COOKIE).sort()).toEqual(
    [LAST_USED_LOGIN_METHOD_COOKIE, 'adiutor.locale'].sort(),
  );
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toContainText(
    'Last used',
  );
});

test('the sign-in page marks the method used last', async ({ page }) => {
  await signIn(page, SESSIONS_CLIENT);
  await signOut(page);
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toHaveAccessibleDescription('Last used');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toContainText(
    'Last used',
  );
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).not.toContainText(
    'Last used',
  );
});
