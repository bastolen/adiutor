/**
 * @file End-to-end tests for a user's own account: verifying your email on
 * the account page and the account's recent activity, deactivating your
 * account (which an Admin can reactivate, and which sends the browser's
 * other tabs to the sign-in page too), and signing out your other
 * devices (which also forgets the browsers you trusted at the code step).
 */
import { type Browser, type Page } from '@playwright/test';

import {
  forgetLimitsOf,
  choosePictureOf,
  markEmailUnverified,
  reactivateAccount,
} from './support/db';
import {
  DEACTIVATE_CLIENT,
  PLATFORM_ADMIN,
  SEEDED_REQUESTS,
  SESSIONS_CLIENT,
  SUPPORT_STAFF,
  UNVERIFIED_USER,
} from './support/fixtures';
import {
  answerPictures,
  fillAndSubmitSignIn,
  openUserTab,
  signIn,
  submitPassword,
  toasts,
  useOwnClientIp,
  APP_HOME_URL,
} from './support/helpers';
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

test('a user shows the picture of an account they connected, or their initials', async ({
  page,
}) => {
  // The seed shows initials. The test chooses pictures: a retry or a repeat starts again from no
  // choice, and leaves initials behind.
  await choosePictureOf(SUPPORT_STAFF.email, null);
  try {
    await answerPictures(page);
    await signIn(page, SUPPORT_STAFF);
    await page.goto('/account');
    const accountMenu = page.getByRole('button', { name: /^Account menu/ });
    const choice = page.getByRole('group', { name: 'Show' });
    const google = choice.getByRole('radio', { name: `Google · ${SUPPORT_STAFF.email}` });

    // Until they choose: the picture of the account they connected first, from Adiutor's address.
    await expect(google).toBeChecked();
    await expect(
      page.getByText('Until you choose, the picture of the account you connected first is shown.'),
    ).toBeVisible();
    await expect(accountMenu.locator('img')).toHaveAttribute(
      'src',
      /^\/avatars\/[0-9a-f-]+\?v=[0-9a-f]{16}$/,
    );

    await choice.getByRole('radio', { name: 'Initials' }).check();
    await page.getByRole('button', { name: 'Save picture' }).click();
    await expect(toasts(page)).toContainText('Picture saved.');
    await expect(accountMenu.locator('img')).toHaveCount(0);
    await expect(page.getByText(/^Until you choose/)).toHaveCount(0);

    // Back to the picture, which also shows on the requests they work on.
    await google.check();
    await page.getByRole('button', { name: 'Save picture' }).click();
    await expect(accountMenu.locator('img')).toHaveCount(1);
    await page.goto(`/requests/${SEEDED_REQUESTS.waiting.number}`);
    await expect(
      page.getByRole('region', { name: 'Conversation' }).locator('img[src^="/avatars/"]').first(),
    ).toBeVisible();
  } finally {
    await choosePictureOf(SUPPORT_STAFF.email, 'initials');
  }
});

test('verify your email from the account page, keeping your password', async ({
  page,
  context,
}) => {
  // The test verifies the address: a retry or a repeat starts again unverified.
  await markEmailUnverified(UNVERIFIED_USER.email);
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

  // The account's recent activity (its Activity tab) shows the sign-in and the verification, newest
  // first.
  await page.goto('/account/activity');
  const activity = page.getByRole('list', { name: 'Your recent activity' });
  await expect(activity.getByRole('listitem').first()).toContainText('Verified your email address');
  await expect(activity).toContainText('Signed in with a password');

  // Verifying didn't remove the password.
  await context.clearCookies();
  await signIn(page, UNVERIFIED_USER);
});

test('a user deactivates their account and an Admin reactivates it', async ({ page, browser }) => {
  // The test deactivates the account: a retry or a repeat starts again with it active, with the
  // wrong password it typed no longer counted.
  await reactivateAccount(DEACTIVATE_CLIENT.email);
  await forgetLimitsOf(DEACTIVATE_CLIENT.email);
  try {
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
    await expect(other).toHaveURL(APP_HOME_URL);
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
    await fillAndSubmitSignIn(page, DEACTIVATE_CLIENT);
    await expect(
      page.getByRole('alert').filter({ hasText: 'This account is deactivated.' }),
    ).toBeVisible();

    const admin = await adminPage(browser);
    await admin.goto('/admin/users?filter=deactivated');
    await expect(
      admin.getByRole('main').getByRole('cell', { name: DEACTIVATE_CLIENT.email, exact: true }),
    ).toBeVisible();
    await openUserTab(admin, DEACTIVATE_CLIENT.name, 'Manage');
    await admin.getByRole('button', { name: 'Reactivate' }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Reactivate' }).click();
    await expect(toasts(admin)).toContainText('Account reactivated.');
    await admin.context().close();

    await signIn(page, DEACTIVATE_CLIENT);
  } finally {
    await reactivateAccount(DEACTIVATE_CLIENT.email);
  }
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
  await other
    .getByLabel('Trust this device (until 30 days after your last password sign-in here)')
    .check();
  await other.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(other).toHaveURL('/dashboard');
  await signIn(page, SESSIONS_CLIENT);

  await page.goto('/account/activity');
  const devices = page.getByRole('table', { name: 'Your signed-in devices' });
  await expect(devices.getByRole('row')).toHaveCount(3);
  await expect(devices.getByText('This device')).toBeVisible();
  const signOutOthers = page
    .getByRole('main')
    .getByRole('button', { name: 'Sign out other devices' });
  await signOutOthers.focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Sign out other devices' })
    .click();
  await expect(toasts(page)).toContainText('Signed out on 1 other device.');
  await expect(devices.getByRole('row')).toHaveCount(2);
  // No other device is left, so the button is off, yet it keeps focus: disabled, it would drop it.
  await expect(signOutOthers).toHaveAttribute('aria-disabled', 'true');
  await expect(signOutOthers).toBeFocused();

  await other.goto('/dashboard');
  await expect(other).toHaveURL(/\/auth/);
  // Its "Trust this device" was forgotten too: the password alone no longer gets in there.
  expect(await submitPassword(other, SESSIONS_CLIENT)).toBe('code-step');
  await other.context().close();
});
