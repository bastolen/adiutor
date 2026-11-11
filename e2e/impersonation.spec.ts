/**
 * @file End-to-end tests for signing in as a user: a staff Admin signs in as a
 * Manager from their page, sees Adiutor as them with the banner, can't change
 * anything (the controls are off, the user's account pages read-only), and
 * goes back to the card; the user is emailed and the audit log has the
 * reason. A Manager signed in as a Watcher doesn't see the Watcher's devices.
 * Signed in as a company Admin who must set up MFA, the Admin sees the
 * Security page that user would see. Support is told why they can't sign in
 * as a company Admin, or without strong MFA.
 */
import { findUserId } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_OWNER,
  COMPANY_SLUG,
  PLATFORM_ADMIN,
  STAFF_NAME,
  STEP_UP_MANAGER,
  SUPPORT_STAFF,
} from './support/fixtures';
import { openUser, signIn, signInAsUser, toasts, useOwnClientIp } from './support/helpers';
import { countEmails, waitForNewEmail } from './support/outbox';
import { expect, test } from './support/test';

test.beforeEach(async ({ page }) => {
  await useOwnClientIp(page);
});

test('a staff Admin signs in as a Manager, changes nothing, and goes back', async ({ page }) => {
  const managerId = await findUserId(STEP_UP_MANAGER.email);
  const emailsBefore = await countEmails(STEP_UP_MANAGER.email);
  // The sign-in's authenticator code is a strong confirmation, so no step-up is needed.
  await signIn(page, PLATFORM_ADMIN);
  await signInAsUser(page, STEP_UP_MANAGER.name, { reason: 'Checking the company settings' });

  // The banner and the account menu say whom the Admin is signed in as.
  const banner = page.getByRole('region', { name: 'Signed in as someone else' });
  await expect(banner).toContainText(
    `You're signed in as ${STEP_UP_MANAGER.name} (${STEP_UP_MANAGER.email}), with changes turned off.`,
  );
  await expect(page.getByRole('button', { name: /^Account menu/ })).toContainText('Signed in as');

  // A Manager may change a company's details and its members, but nothing changes from their view:
  // the controls are off (and the server refuses them anyway, see the authorization matrix).
  await page.goto(`/companies/${COMPANY_SLUG}/settings`);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Deactivate company' })).toBeDisabled();
  await page.goto(`/companies/${COMPANY_SLUG}/members`);
  await expect(
    page.getByRole('combobox', { name: `Role of ${CLIENT_WATCHER.name}` }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: `Remove ${CLIENT_WATCHER.name}` })).toBeDisabled();

  // The Manager's own account pages show as the Manager sees them, read-only. A staff Admin sees
  // everything there, devices included, as on the Manager's user page.
  await page.goto('/account/security');
  await expect(page.getByRole('main')).toContainText(
    `You're viewing ${STEP_UP_MANAGER.name}'s account pages as they see them.`,
  );
  await expect(page.getByRole('main')).not.toContainText('Some of their personal details');
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add passkey' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New backup codes' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled();

  // Back to the Admin's own account, on the card they started from.
  await banner.getByRole('button', { name: 'Back to my account' }).click();
  await expect(page).toHaveURL(`/admin/users/${managerId}#sign-in-as`);
  await expect(toasts(page)).toContainText("You're back in your own account.");
  await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toHaveCount(0);

  // The Manager was emailed, naming the Admin, and the audit log has the reason.
  const notice = await waitForNewEmail(STEP_UP_MANAGER.email, emailsBefore);
  expect(notice.subject).toBe(
    `${PLATFORM_ADMIN.name} from ${STAFF_NAME} signed in to Adiutor as you`,
  );
  await page.goto(`/admin/logs?q=${encodeURIComponent(STEP_UP_MANAGER.name)}`);
  await expect(page.getByRole('main')).toContainText('Signed in as a user');
  await expect(page.getByRole('main')).toContainText('Reason: Checking the company settings');
  await expect(page.getByRole('main')).toContainText('Went back from signing in as a user');
});

test('a Manager signed in as a Watcher sees their account pages without devices', async ({
  page,
}) => {
  // The Manager's sign-in code is a strong confirmation too.
  await signIn(page, STEP_UP_MANAGER);
  await signInAsUser(page, CLIENT_WATCHER.name);

  await page.goto('/account/security');
  await expect(page.getByRole('main')).toContainText(
    'Some of their personal details are left out, as on their user page.',
  );
  // Only staff Admins see a user's devices; Managers see the rest, read-only.
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to my account' }).click();
  await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toHaveCount(0);
});

test('signed in as a company Admin who must set up MFA, the Admin sees what they would', async ({
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await signInAsUser(page, COMPANY_OWNER.name, { landsOn: '/account/security?setup=required' });

  await expect(page.getByRole('main')).toContainText(
    `${COMPANY_OWNER.name} has to set up MFA before they can use Adiutor, so this Security page is what they see now.`,
  );
  await page.getByRole('button', { name: 'Back to my account' }).click();
  await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toHaveCount(0);
});

test('Support is told why they can’t sign in as someone', async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);

  await openUser(page, COMPANY_OWNER.name);
  await expect(page.getByText("Support can't sign in as a company Admin.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in as user' })).toBeDisabled();

  // A Watcher is within Support's reach, but this Support member has no strong MFA yet.
  await openUser(page, CLIENT_WATCHER.name);
  await expect(page.getByRole('link', { name: 'Security page' })).toHaveAttribute(
    'href',
    '/account/security#passkeys',
  );
  await expect(page.getByRole('button', { name: 'Sign in as user' })).toBeDisabled();
});
