/**
 * @file End-to-end tests for registering users and managing them from the
 * user detail page: their company memberships, staff access, two-step
 * verification (reset) and account (delete), and what an Admin's own page
 * offers (their companies, but no staff access or account actions).
 */
import { type Page } from '@playwright/test';

import { DELETE_CLIENT, PLATFORM_ADMIN, RESET_CLIENT } from './support/fixtures';
import { freshAddress, openUser, signIn, signOut, toasts } from './support/helpers';
import { countEmails, linkIn, waitForEmail, waitForNewEmail } from './support/outbox';
import { expect, test } from './support/test';

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
  expect(welcome.subject).toBe('Your Adiutor account is ready');
  await page.goto(linkIn(welcome));
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('registered-password-1');
  await page.getByLabel('Confirm password').fill('registered-password-1');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('heading', { name: 'Password saved' })).toBeVisible();

  await signIn(page, { email, password: 'registered-password-1' });
  await expect(page).toHaveURL('/dashboard');
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
  const staff = page.getByRole('region', { name: 'Staff access' });
  before = await countEmails(email);
  await staff.getByRole('button', { name: 'Make staff' }).click();
  const staffDialog = page.getByRole('dialog', { name: /^Make .* staff\?$/ });
  await staffDialog.getByRole('button', { name: 'Make staff' }).click();
  await expect(staff.getByRole('combobox', { name: /^Role of / })).toHaveText('Support');
  expect((await waitForNewEmail(email, before)).subject).toBe(
    'You now have staff access to Adiutor',
  );

  await staff.getByRole('combobox', { name: /^Role of / }).click();
  await page.getByRole('option', { name: 'Finance' }).click();
  await expect(toasts(page)).toContainText('Staff role saved.');

  before = await countEmails(email);
  await staff.getByRole('button', { name: 'Remove staff access' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove staff access' }).click();
  await expect(staff.getByRole('button', { name: 'Make staff' })).toBeVisible();
  expect((await waitForNewEmail(email, before)).subject).toBe(
    'Your Adiutor staff access was removed',
  );
});

test('an Admin resets two-step verification, deletes a user, and on their own page manages only their companies', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);

  // Their own page has no staff access or account actions (those are on the Staff and Security
  // pages), but their companies are managed as anyone's. Only looked at, never saved, so the
  // seeded memberships stay as they are.
  await openUser(page, PLATFORM_ADMIN.name);
  await expect(page.getByText('This is your own account.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Staff page', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Staff access' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Account access' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Delete account' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out everywhere' })).toHaveCount(0);
  await page
    .getByRole('region', { name: 'Companies' })
    .getByRole('button', { name: 'Add to company' })
    .click();
  const addSelf = page.getByRole('dialog', { name: 'Add yourself to a company' });
  await expect(addSelf).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(addSelf).toHaveCount(0);

  await openUser(page, RESET_CLIENT.name);
  const before = await countEmails(RESET_CLIENT.email);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const reset = page.getByRole('dialog', { name: /^Reset two-step verification/ });
  await reset.getByRole('button', { name: 'Reset two-step verification' }).click();
  await expect(reset).toHaveCount(0);
  await expect(toasts(page)).toContainText('Two-step verification was reset.');
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  expect((await waitForNewEmail(RESET_CLIENT.email, before)).subject).toBe(
    'Your Adiutor two-step verification was reset',
  );

  await openUser(page, DELETE_CLIENT.name);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const remove = page.getByRole('dialog', { name: /^Delete .*account\?$/ });
  await remove.getByLabel('Email address').fill('someone@adiutor.test');
  await remove.getByRole('button', { name: 'Delete account' }).click();
  await expect(remove.getByRole('alert')).toHaveText('Type the email address exactly to confirm.');
  await remove.getByLabel('Email address').fill(DELETE_CLIENT.email);
  await remove.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL('/admin/users?deleted=1');
  await expect(toasts(page)).toContainText('User deleted.');
  // Rows only (the previous page stays in the DOM, hidden, for back navigation).
  await expect(page.getByRole('row').filter({ hasText: DELETE_CLIENT.email })).toHaveCount(0);

  // The reset user signs in with just their password now.
  await signOut(page);
  await signIn(page, RESET_CLIENT);
});
