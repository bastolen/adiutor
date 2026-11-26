/**
 * @file End-to-end tests for registering users and managing them from the
 * user detail page: their company memberships, staff access, two-step
 * verification (reset) and account (reactivate, which asks the Admin to
 * confirm it's them first for an account that gets its staff role back, and
 * delete), and what an Admin's own page offers (their companies, but no
 * staff access or account actions), and who sees which provider account a
 * user has.
 */
import { type Page } from '@playwright/test';

import {
  backdateMfaConfirmation,
  deactivateAccount,
  findUserId,
  restoreAuthenticatorOf,
} from './support/db';
import {
  GITHUB_ONLY_MANAGER,
  PLATFORM_ADMIN,
  RESET_CLIENT,
  RETURNING_FINANCE,
  STAFF_NAME,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  chooseUserTab,
  confirmWithAuthenticator,
  freshAddress,
  openUser,
  openUserTab,
  signIn,
  signOut,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { countEmails, linkIn, waitForEmail, waitForNewEmail } from './support/outbox';
import { expect, test } from './support/test';
import { codeForSecret } from './support/totp';

/**
 * Registers a user from the add-user page, as a signed-in Admin.
 *
 * @param page - The browser page.
 * @param email - The address to register.
 */
async function registerUser(page: Page, email: string): Promise<void> {
  await page.goto('/admin/users');
  await page.getByRole('link', { name: 'Add user' }).click();
  await expect(page).toHaveURL('/admin/users/new');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByRole('status')).toContainText(`Account created for ${email}.`);
}

test('an Admin registers a user, who chooses a password from the welcome email', async ({
  page,
}) => {
  const email = freshAddress('registered');
  await signIn(page, PLATFORM_ADMIN);
  await registerUser(page, email);

  // Registering the same address again only says it exists.
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByRole('status')).toContainText(`${email} already has an account.`);
  await signOut(page);

  const welcome = await waitForEmail(email);
  expect(welcome.subject).toBe(`Your account on ${STAFF_NAME} is ready`);
  await page.goto(linkIn(welcome));
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('registered-password-1');
  await page.getByLabel('Confirm password').fill('registered-password-1');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('heading', { name: 'Password saved' })).toBeVisible();

  await signIn(page, { email, password: 'registered-password-1' });
  await expect(page).toHaveURL('/dashboard');
});

test('"Add another" starts an empty form, which keeps an address the server refuses', async ({
  page,
}) => {
  const email = freshAddress('first');
  await signIn(page, PLATFORM_ADMIN);
  await registerUser(page, email);

  // A new, empty form with focus on its email field: the button that had focus is gone.
  await page.getByRole('button', { name: 'Add another' }).click();
  const field = page.getByLabel('Email', { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
  await expect(page.getByRole('link', { name: 'Open user' })).toHaveCount(0);

  // The browser lets an address without a top-level domain through; the server refuses it.
  await field.fill('colleague@adiutor');
  await page.getByRole('button', { name: 'Add user' }).click();
  const error = page.getByRole('main').getByRole('alert');
  await expect(error).toHaveText('Enter a valid email address.');
  await expect(error).toBeFocused();
  // What was typed is still there, and the first user's confirmation never came back.
  await expect(field).toHaveValue('colleague@adiutor');
  await expect(page.getByRole('link', { name: 'Open user' })).toHaveCount(0);
  await expect(page.getByText(`Account created for ${email}.`)).toHaveCount(0);

  // Corrected, it goes through, and the confirmation is the new user's.
  const second = freshAddress('second');
  await field.fill(second);
  await page.getByRole('button', { name: 'Add user' }).click();
  // Within the content: the refusal's toast may still be up.
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    `Account created for ${second}.`,
  );
});

test('an Admin adds a user to a company and gives them staff access from their page', async ({
  page,
}) => {
  const email = freshAddress('managed');
  await signIn(page, PLATFORM_ADMIN);
  await registerUser(page, email);
  await page.getByRole('link', { name: 'Open user' }).click();
  await expect(page.getByRole('heading', { level: 1, name: email })).toBeVisible();

  // Add them to a company, change the role, then remove them. The address already has its welcome
  // email, so each email after it is counted first.
  await chooseUserTab(page, 'Companies');
  const companies = page.getByRole('region', { name: 'Companies' });
  let before = await countEmails(email);
  await companies.getByRole('button', { name: 'Add to company' }).click();
  const addDialog = page.getByRole('dialog', { name: /^Add .* to a company$/ });
  await addDialog.getByRole('combobox', { name: 'Role', exact: true }).click();
  await page.getByRole('option', { name: 'Watcher' }).click();
  await addDialog.getByRole('button', { name: 'Add to company' }).click();
  await expect(addDialog).toHaveCount(0);
  await expect(toasts(page)).toContainText('Added to the company. We emailed them.');
  expect((await waitForNewEmail(email, before)).subject).toContain('You were added to');

  const row = companies.getByRole('row').nth(1);
  await row.getByRole('combobox', { name: /^Role of / }).click();
  await page.getByRole('option', { name: /^Client/ }).click();
  await expect(toasts(page)).toContainText('Role updated.');
  await row.getByRole('button', { name: /^Remove / }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove member' }).click();
  await expect(companies.getByText('Not a member of any company.')).toBeVisible();
  // The row went, so the toast names it and focus moves to the card's heading.
  await expect(toasts(page)).toContainText(/ was removed from /);
  await expect(companies.getByRole('heading', { name: 'Companies' })).toBeFocused();

  // Make them staff, change the role, then remove staff access.
  await chooseUserTab(page, 'Overview');
  const staff = page.getByRole('region', { name: 'Staff access' });
  before = await countEmails(email);
  await staff.getByRole('button', { name: 'Make staff' }).click();
  const staffDialog = page.getByRole('dialog', { name: /^Make .* staff\?$/ });
  await staffDialog.getByRole('button', { name: 'Make staff' }).click();
  await expect(staff.getByRole('combobox', { name: /^Role of / })).toHaveText('Support');
  expect((await waitForNewEmail(email, before)).subject).toBe(
    `You now have staff access to ${STAFF_NAME}`,
  );

  await staff.getByRole('combobox', { name: /^Role of / }).click();
  await page.getByRole('option', { name: 'Finance' }).click();
  await expect(toasts(page)).toContainText('Staff role saved.');

  before = await countEmails(email);
  await staff.getByRole('button', { name: 'Remove staff access' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove staff access' }).click();
  await expect(staff.getByRole('button', { name: 'Make staff' })).toBeVisible();
  expect((await waitForNewEmail(email, before)).subject).toBe(
    `Your staff access to ${STAFF_NAME} was removed`,
  );
});

test('an Admin resets two-step verification, deletes a user, and on their own page manages only their companies', async ({
  page,
}) => {
  // The test resets their authenticator app: a retry or a repeat starts again with one. The
  // account it deletes is registered by the test itself.
  await restoreAuthenticatorOf(RESET_CLIENT);
  const deleted = freshAddress('delete');
  await signIn(page, PLATFORM_ADMIN);

  // Their own page has no staff access or account actions (those are in the staff settings and on the
  // Security page), but their companies are managed as anyone's. Only looked at, never saved, so the
  // seeded memberships stay as they are.
  await openUser(page, PLATFORM_ADMIN.name);
  await expect(page.getByText('This is your own account.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'staff settings', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Staff access' })).toHaveCount(0);
  // No Manage tab (account access, deleting), and their devices without "Sign out everywhere".
  const tabs = page.getByRole('navigation', { name: 'User sections' });
  await expect(tabs.getByRole('link', { name: 'Manage' })).toHaveCount(0);
  await chooseUserTab(page, 'Activity');
  await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out everywhere' })).toHaveCount(0);
  await chooseUserTab(page, 'Companies');
  await page
    .getByRole('region', { name: 'Companies' })
    .getByRole('button', { name: 'Add to company' })
    .click();
  const addSelf = page.getByRole('dialog', { name: 'Add yourself to a company' });
  await expect(addSelf).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(addSelf).toHaveCount(0);

  await openUserTab(page, RESET_CLIENT.name, 'Manage');
  const before = await countEmails(RESET_CLIENT.email);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const reset = page.getByRole('dialog', { name: /^Reset two-step verification/ });
  await reset.getByRole('button', { name: 'Reset two-step verification' }).click();
  await expect(reset).toHaveCount(0);
  await expect(toasts(page)).toContainText('Two-step verification was reset.');
  // Its sign-in security, on the Overview, says so.
  await chooseUserTab(page, 'Overview');
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  expect((await waitForNewEmail(RESET_CLIENT.email, before)).subject).toBe(
    `Your two-step verification for ${STAFF_NAME} was reset`,
  );

  await registerUser(page, deleted);
  await page.getByRole('link', { name: 'Open user' }).click();
  await expect(page.getByRole('heading', { level: 1, name: deleted })).toBeVisible();
  await chooseUserTab(page, 'Manage');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const remove = page.getByRole('dialog', { name: /^Delete .*account\?$/ });
  await remove.getByLabel('Email address').fill('someone@adiutor.test');
  await remove.getByRole('button', { name: 'Delete account' }).click();
  await expect(remove.getByRole('alert')).toHaveText('Type the email address exactly to confirm.');
  await remove.getByLabel('Email address').fill(deleted);
  await remove.getByRole('button', { name: 'Delete account' }).click();
  await expect(toasts(page)).toContainText('User deleted.');
  // Said once: what asked for it leaves the address.
  await expect(page).toHaveURL('/admin/users');
  await expect(page.getByRole('row').filter({ hasText: deleted })).toHaveCount(0);
  // Back doesn't show the deleted user's page as it was kept: there's nobody there anymore.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: deleted })).toHaveCount(0);

  // The reset user signs in with just their password now.
  await page.goto('/admin/users');
  await signOut(page);
  await signIn(page, RESET_CLIENT);
});

test('an Admin who confirmed long ago confirms it’s them before reactivating a staff member', async ({
  page,
}) => {
  // Waits for the next authenticator code (up to 30 seconds) on top of the sign-in.
  test.setTimeout(120_000);
  // The seed deactivated them, keeping their staff role; again here, so a retry starts the same.
  await deactivateAccount(RETURNING_FINANCE.email);
  await signIn(page, PLATFORM_ADMIN);
  // The code just used to sign in (or an earlier one); confirming again needs a later one.
  const signInCode = codeForSecret(PLATFORM_ADMIN.totpSecret);
  // Signed in 20 minutes ago, as far as the confirmation window goes.
  await backdateMfaConfirmation(PLATFORM_ADMIN.email, 20);

  // They get their staff role back, so Reactivate asks first, before its confirmation opens, and
  // the step-up page comes back to the card.
  const manage = `/admin/users/${await findUserId(RETURNING_FINANCE.email)}/manage`;
  await page.goto(manage);
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page).toHaveURL(
    `/auth/verify?callbackURL=${encodeURIComponent(`${manage}#account-access`)}&for=change`,
  );
  await expect(page.getByRole('heading', { name: /^Confirm it.s you$/ })).toBeVisible();
  // An authenticator code can't be used twice, so wait for the next one.
  await expect
    .poll(() => codeForSecret(PLATFORM_ADMIN.totpSecret), { timeout: 35_000, intervals: [1_000] })
    .not.toBe(signInCode);
  await confirmWithAuthenticator(page, PLATFORM_ADMIN.totpSecret);

  // Back on the card, where it goes ahead now.
  await expect(page).toHaveURL(`${manage}#account-access`, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page
    .getByRole('alertdialog', { name: `Reactivate ${RETURNING_FINANCE.name}?` })
    .getByRole('button', { name: 'Reactivate' })
    .click();
  await expect(toasts(page)).toContainText('Account reactivated.');
  await expect(page.getByRole('button', { name: 'Deactivate' })).toBeVisible();
});

test('only staff Admins see which GitHub account a user signs in with', async ({
  page,
  browser,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/admin/users?q=${encodeURIComponent(GITHUB_ONLY_MANAGER.email)}`);
  await page.getByRole('main').getByRole('link', { name: GITHUB_ONLY_MANAGER.name }).click();
  await expect(page.getByRole('heading', { name: GITHUB_ONLY_MANAGER.name })).toBeVisible();
  await expect(
    page.getByRole('main').getByText(GITHUB_ONLY_MANAGER.githubLogin, { exact: true }),
  ).toBeVisible();
  const userPage = page.url();

  // Support may view users, but not which account they have at a provider.
  const context = await browser.newContext();
  const support = await context.newPage();
  await useOwnClientIp(support);
  await signIn(support, SUPPORT_STAFF);
  await support.goto(userPage);
  await expect(support.getByRole('heading', { name: GITHUB_ONLY_MANAGER.name })).toBeVisible();
  // The GitHub row says only "Connected" (next to its 2FA badge).
  await expect(
    support
      .getByRole('main')
      .getByRole('definition')
      .filter({ hasText: /^Connected/ }),
  ).toBeVisible();
  await expect(support.getByText(GITHUB_ONLY_MANAGER.githubLogin)).toHaveCount(0);
  await context.close();
});
