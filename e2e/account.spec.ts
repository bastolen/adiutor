/**
 * @file End-to-end tests for a user's own account: verifying your email on
 * the account page and the account's recent activity, deactivating your
 * account (which an Admin can reactivate, and which sends the browser's
 * other tabs to the sign-in page too), and signing out your other
 * devices (which also forgets the browsers you trusted at the code step).
 */
import { type Browser, type Page } from '@playwright/test';

import {
  DEACTIVATE_CLIENT,
  PLATFORM_ADMIN,
  SESSIONS_CLIENT,
  UNVERIFIED_USER,
} from './support/fixtures';
import { openUser, signIn, submitPassword, toasts, useOwnClientIp } from './support/helpers';
import { countEmails, linkIn, waitForNewEmail } from './support/outbox';
import { expect, test } from './support/test';
import { codeForSecret } from './support/totp';

/**
 * Signs in as the Admin in a new browser context.
 *
 * @param browser - The browser.
 * @returns The page.
 */
async function adminPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, PLATFORM_ADMIN);
  return page;
}

test('verify your email from the account page, keeping your password', async ({
  page,
  context,
}) => {
  await signIn(page, UNVERIFIED_USER);
  await page.goto('/account');
  // In the page content: right after loading, React's streamed copy may still be in the document.
  await expect(page.getByRole('main').getByText('Not verified')).toBeVisible();

  const before = await countEmails(UNVERIFIED_USER.email);
  await page.getByRole('button', { name: 'Send verification email' }).click();
  await expect(toasts(page)).toContainText(
    `We've sent a verification link to ${UNVERIFIED_USER.email}`,
  );

  const email = await waitForNewEmail(UNVERIFIED_USER.email, before);
  expect(email.subject).toBe('Verify your Adiutor email address');
  await page.goto(linkIn(email));

  // Back on the Email card, which says it worked (the message takes focus).
  await expect(page).toHaveURL('/account?verified=1#email');
  const emailCard = page.getByRole('region', { name: 'Email' });
  await expect(
    emailCard.getByRole('status').filter({ hasText: 'Your email address is verified.' }),
  ).toBeFocused();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send verification email' })).toHaveCount(0);

  // The account's recent activity shows the sign-in and the verification, newest first.
  const activity = page.getByRole('list', { name: 'Your recent activity' });
  await expect(activity.getByRole('listitem').first()).toContainText('Verified your email address');
  await expect(activity).toContainText('Signed in with a password');

  // Verifying didn't remove the password.
  await context.clearCookies();
  await signIn(page, UNVERIFIED_USER);
});

test('a user deactivates their account and an Admin reactivates it', async ({ page, browser }) => {
  await signIn(page, DEACTIVATE_CLIENT);
  const before = await countEmails(DEACTIVATE_CLIENT.email);
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Deactivate your account?' });
  await dialog.getByLabel('Current password').fill('wrong password');
  await dialog.getByRole('button', { name: 'Deactivate my account' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('That password is incorrect.');
  // Another tab of the same browser has the dashboard open.
  const other = await page.context().newPage();
  await other.goto('/dashboard');
  await expect(other).toHaveURL(/\/(dashboard|companies\/)/);
  await dialog.getByLabel('Current password').fill(DEACTIVATE_CLIENT.password);
  await dialog.getByRole('button', { name: 'Deactivate my account' }).click();

  await expect(page).toHaveURL(/\/auth\?error=ACCOUNT_DEACTIVATED/);
  // Without a click, the other tab loads afresh too, signed out.
  await expect(other).toHaveURL(/\/auth\?callbackURL=/);
  await other.close();
  expect((await waitForNewEmail(DEACTIVATE_CLIENT.email, before)).subject).toBe(
    'Your Adiutor account was deactivated',
  );

  // Signing in is refused (from an address of its own: this is the third sign-in in seconds).
  await useOwnClientIp(page);
  await page.goto('/auth');
  await page.getByLabel('Email').fill(DEACTIVATE_CLIENT.email);
  await page.getByLabel('Password').fill(DEACTIVATE_CLIENT.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This account is deactivated.' }),
  ).toBeVisible();

  const admin = await adminPage(browser);
  await admin.goto('/admin/users?filter=deactivated');
  await expect(
    admin.getByRole('main').getByRole('cell', { name: DEACTIVATE_CLIENT.email, exact: true }),
  ).toBeVisible();
  await openUser(admin, DEACTIVATE_CLIENT.name);
  await admin.getByRole('button', { name: 'Reactivate' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Reactivate' }).click();
  await expect(toasts(admin)).toContainText('Account reactivated.');
  await admin.context().close();

  await signIn(page, DEACTIVATE_CLIENT);
});

test('a user signs out their other devices, which also forgets trusted browsers', async ({
  page,
  browser,
}) => {
  const other = await (await browser.newContext()).newPage();
  // Its own address, so its code step isn't held up by other tests' sign-ins.
  await useOwnClientIp(other);
  // The other browser was trusted at the code step.
  expect(await submitPassword(other, SESSIONS_CLIENT)).toBe('code-step');
  await other
    .getByRole('textbox', { name: 'Code', exact: true })
    .fill(codeForSecret(SESSIONS_CLIENT.totpSecret));
  await other.getByLabel('Trust this device for 30 days').check();
  await other.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(other).toHaveURL('/dashboard');
  await signIn(page, SESSIONS_CLIENT);

  await page.goto('/account/security');
  const devices = page.getByRole('table', { name: 'Your signed-in devices' });
  await expect(devices.getByRole('row')).toHaveCount(3);
  await expect(devices.getByText('This device')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out other devices' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Sign out other devices' })
    .click();
  await expect(toasts(page)).toContainText('Signed out on 1 other device.');
  await expect(devices.getByRole('row')).toHaveCount(2);

  await other.goto('/dashboard');
  await expect(other).toHaveURL(/\/auth/);
  // Its "Trust this device" was forgotten too: the password alone no longer gets in there.
  expect(await submitPassword(other, SESSIONS_CLIENT)).toBe('code-step');
  await other.context().close();
});
