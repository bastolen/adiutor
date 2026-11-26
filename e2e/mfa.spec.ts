/**
 * @file End-to-end tests for MFA: the requirement for staff Admins and
 * Managers and the Admins of active companies, authenticator apps with
 * backup codes, email codes with trusted devices (and the sign-ins they leave
 * in Recent activity), passkeys (signing in, and confirming a session on the
 * step-up page), confirming a session that signed in with an email link, and
 * the recommendation for everyone else.
 */

import {
  clearMfaRecommendationDismissal,
  removePasskeysOf,
  resetMfaOf,
  storeSignInLink,
} from './support/db';
import {
  CLIENT_WATCHER,
  CLOSED_COMPANY_ADMIN,
  COMPANY_OWNER,
  MFA_CLIENT,
  PASSKEY_CLIENT,
  PLATFORM_ADMIN,
  PLATFORM_MANAGER,
  STAFF_NAME,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  confirmWithAuthenticator,
  openSignInLink,
  setUpAuthenticator,
  signIn,
  signOut,
  submitPassword,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { codeIn, countEmails, linkIn, waitForNewEmail } from './support/outbox';
import { expect, test } from './support/test';

test('a Manager must set up MFA first, then signs in with an authenticator or a backup code', async ({
  page,
}) => {
  // The test sets up their authenticator: a retry or a repeat starts again without one.
  await resetMfaOf(PLATFORM_MANAGER.email);
  await signIn(page, PLATFORM_MANAGER);
  await expect(page).toHaveURL('/account/security?setup=required');
  await expect(page.getByText(/^Your role requires MFA\./)).toBeVisible();
  // Email codes don't count for Managers, so they aren't offered.
  await expect(page.getByRole('button', { name: 'Use email codes' })).toHaveCount(0);

  // Every app page sends them back here until it's set up.
  await page.goto('/admin/companies');
  await expect(page).toHaveURL('/account/security?setup=required');

  // Better Auth labels the new authenticator entry with the staff's name and Adiutor's.
  const enabled = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/two-factor/enable',
  );
  const backupCode = await setUpAuthenticator(page, PLATFORM_MANAGER.password);
  const { totpURI } = (await (await enabled).json()) as { totpURI: string };
  expect(new URL(totpURI).searchParams.get('issuer')).toBe(`${STAFF_NAME} (Adiutor)`);

  await page.goto('/admin/companies');
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();

  // A backup code works instead of the app.
  await signOut(page);
  expect(await submitPassword(page, PLATFORM_MANAGER)).toBe('code-step');
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await page.getByLabel('Backup code').fill(backupCode);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
});

test("a company's Admin must set up MFA, but not while the company is deactivated", async ({
  page,
}) => {
  await signIn(page, COMPANY_OWNER);
  await expect(page).toHaveURL('/account/security?setup=required');
  await expect(page.getByText(/^Your role requires MFA\./)).toBeVisible();
  // Email codes don't count for company Admins either.
  await expect(page.getByRole('button', { name: 'Use email codes' })).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/account/security?setup=required');

  await signOut(page);
  await signIn(page, CLOSED_COMPANY_ADMIN);
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/account/security');
  await expect(page.getByText(/^Your role requires MFA\./)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use email codes' })).toBeVisible();
});

test('a company user turns on email codes and can trust the device until signing out', async ({
  page,
}) => {
  // The test turns email codes on: a retry starts again from an account without them.
  await resetMfaOf(MFA_CLIENT.email);
  await signIn(page, MFA_CLIENT);
  await page.goto('/account/security');

  await page.getByRole('button', { name: 'Use email codes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Use email codes' });
  let sent = await countEmails(MFA_CLIENT.email);
  await dialog.getByRole('button', { name: 'Send a code to check it works' }).click();
  const setupEmail = await waitForNewEmail(MFA_CLIENT.email, sent);
  expect(setupEmail.subject).toBe(`Your sign-in code for ${STAFF_NAME}`);
  await dialog.getByRole('textbox', { name: 'Code', exact: true }).fill(codeIn(setupEmail));
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();

  // Signing in with the password now asks for a code, sent straight away.
  await signOut(page);
  sent = await countEmails(MFA_CLIENT.email);
  expect(await submitPassword(page, MFA_CLIENT)).toBe('code-step');
  const signInEmail = await waitForNewEmail(MFA_CLIENT.email, sent);
  // The code just sent makes "Send a new code" wait: it ignores Enter, but keeps keyboard focus.
  const resend = page.getByRole('button', { name: /^Send a new code in/ });
  await resend.focus();
  await page.keyboard.press('Enter');
  await expect(resend).toBeFocused();
  await expect(resend).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill(codeIn(signInEmail));
  await page
    .getByLabel('Trust this device (until 30 days after your last password sign-in here)')
    .check();
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL('/dashboard');

  // On this browser, a sign-in after the session ended (without signing out) skips the code step.
  await page.context().clearCookies({ name: /session/ });
  await signIn(page, MFA_CLIENT);
  await expect(page).toHaveURL('/dashboard');

  // Recent activity shows each sign-in once, newest first. Turning email codes on isn't one, and
  // the password typed before the code step is shown without a device or IP address: whoever
  // typed it may be someone else.
  await page.goto('/account/activity');
  const activity = page.getByRole('list', { name: 'Your recent activity' }).getByRole('listitem');
  await Promise.all(
    [
      /^Signed in with a password(?! and)/,
      /^Signed in with a password and an email code/,
      /^Entered your password; the sign-in then asked for your code/,
      /^Turned on two-step verification/,
      /^Signed in with a password(?! and)/,
    ].map((description, index) => expect(activity.nth(index)).toHaveText(description)),
  );
  await expect(activity.nth(2)).not.toContainText('·');

  // Signing out forgets the device, so the next sign-in asks for a code again. From another
  // address: a fourth sign-in on this one would wait out Better Auth's limit (3 per 10 seconds).
  await signOut(page);
  await useOwnClientIp(page);
  expect(await submitPassword(page, MFA_CLIENT)).toBe('code-step');
});

test('a company user adds a passkey and is offered it when signing in', async ({
  page,
  context,
}) => {
  // The test adds a passkey: a retry or a repeat starts again without one.
  await removePasskeysOf(PASSKEY_CLIENT.email);
  // A virtual authenticator stands in for the device's fingerprint or PIN.
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await signIn(page, PASSKEY_CLIENT);
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Add passkey' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a passkey' });
  await dialog.getByLabel('Name').fill('Test laptop');
  // The passkey is labelled with the staff's name and Adiutor's.
  const options = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/passkey/generate-register-options',
  );
  await dialog.getByRole('button', { name: 'Create passkey' }).click();
  expect(((await (await options).json()) as { rp: { name: string } }).rp.name).toBe(
    `${STAFF_NAME} (Adiutor)`,
  );
  await expect(toasts(page)).toContainText('Test laptop was added.');
  await expect(page.getByRole('button', { name: 'Rename Test laptop' })).toBeVisible();

  // Signed out, the sign-in page offers the saved passkey in the browser's suggestions
  // (WebAuthn conditional UI). The virtual authenticator picks it at once, like a user would.
  await context.clearCookies();
  await page.goto('/auth');
  await expect(page).toHaveURL('/dashboard');

  // Signed in without a second step (an email link), confirming with the passkey on the step-up
  // page confirms that session: Recent activity shows it as such, not as another sign-in.
  await context.clearCookies();
  await openSignInLink(page, await storeSignInLink(PASSKEY_CLIENT.email));
  await expect(page).toHaveURL(/\/auth\/verify/);
  await page.getByRole('button', { name: 'Confirm with a passkey' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.goto('/account/activity');
  const activity = page.getByRole('list', { name: 'Your recent activity' }).getByRole('listitem');
  await Promise.all(
    [
      /^Verified a sign-in with MFA/,
      /^Signed in with an email link/,
      /^Signed in with a passkey/,
    ].map((description, index) => expect(activity.nth(index)).toHaveText(description)),
  );
});

test('everyone else is recommended MFA, and can dismiss the recommendation for themselves', async ({
  browser,
  page,
}) => {
  await clearMfaRecommendationDismissal(CLIENT_WATCHER.email);
  await signIn(page, CLIENT_WATCHER);
  const banner = page.getByRole('region', { name: 'Account security' });
  await expect(banner).toContainText('Protect your account');

  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);
  // Saved with the account: once the save is done, a reload no longer has it, straight from the
  // server.
  await expect
    .poll(async () => {
      await page.reload();
      await page.getByRole('heading', { level: 1 }).waitFor();
      return banner.count();
    })
    .toBe(0);

  // And on another device.
  const otherDevice = await browser.newContext();
  const otherPage = await otherDevice.newPage();
  await useOwnClientIp(otherPage);
  await signIn(otherPage, CLIENT_WATCHER);
  await expect(otherPage.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(otherPage.getByRole('region', { name: 'Account security' })).toHaveCount(0);
  await otherDevice.close();

  // Someone else signing in on this browser still sees theirs.
  await signOut(page);
  await signIn(page, SUPPORT_STAFF);
  await expect(banner).toContainText('Protect your account');
});

test('an Admin signing in with an email link confirms the session with a code', async ({
  page,
}) => {
  await page.goto('/auth?callbackURL=%2Fadmin%2Fusers');
  await page.getByRole('button', { name: 'Sign in with an email link instead' }).click();
  await page.getByLabel('Email').fill(PLATFORM_ADMIN.email);
  const before = await countEmails(PLATFORM_ADMIN.email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  const email = await waitForNewEmail(PLATFORM_ADMIN.email, before);
  await openSignInLink(page, linkIn(email));

  await expect(page).toHaveURL(/\/auth\/verify\?callbackURL=%2Fadmin%2Fusers/);
  await expect(page.getByRole('heading', { name: /^Confirm it.s you$/ })).toBeVisible();

  await confirmWithAuthenticator(page, PLATFORM_ADMIN.totpSecret);
  await expect(page).toHaveURL('/admin/users');

  // The session is confirmed now: other pages don't ask again.
  await page.goto('/admin/companies');
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
});
