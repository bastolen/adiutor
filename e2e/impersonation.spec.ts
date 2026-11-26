/**
 * @file End-to-end tests for staff signing in as a user: what the banner, the
 * account pages and the other tabs show, who may do it, and a user turning it
 * off.
 */
import { allowStaffSignInOf, endSignInAsSoon, findUserId } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_OWNER,
  COMPANY_SLUG,
  PLATFORM_ADMIN,
  STAFF_NAME,
  STEP_UP_MANAGER,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  openAccountSettings,
  openUserTab,
  signIn,
  signInAsUser,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { countEmails, waitForNewEmail } from './support/outbox';
import { expect, test } from './support/test';

test('a staff Admin signs in as a Manager, changes nothing, and goes back', async ({ page }) => {
  const managerId = await findUserId(STEP_UP_MANAGER.email);
  const emailsBefore = await countEmails(STEP_UP_MANAGER.email);
  // The sign-in's authenticator code is a strong confirmation, so no step-up is needed.
  await signIn(page, PLATFORM_ADMIN);
  await signInAsUser(page, STEP_UP_MANAGER.name, { reason: 'Checking the company settings' });

  // The banner and the account menu say whom the Admin is signed in as.
  const banner = page.getByRole('region', { name: 'Signed in as someone else' });
  await expect(banner).toContainText(
    `You're signed in as ${STEP_UP_MANAGER.name} (${STEP_UP_MANAGER.email}). You can work on their requests; everything else is read-only.`,
  );
  await expect(page.getByRole('button', { name: /^Account menu/ })).toContainText('Signed in as');

  // A Manager may change a company's details and its members, but nothing changes from their view:
  // the controls are off (and the server refuses them anyway, see the authorization matrix).
  await page.goto(`/companies/${COMPANY_SLUG}/settings`);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  // The fields too, not only the button that would save them.
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'URL name' })).toBeDisabled();
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
  await page.goto('/account/activity');
  await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
  await page.goto('/account/preferences');
  await expect(page.getByRole('combobox', { name: 'Language' })).toBeDisabled();
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();
  // A click on the disabled field leaves focus where it was: if it went to the main content,
  // Chrome would draw a text cursor in the field.
  await page.getByRole('textbox', { name: 'Name', exact: true }).click({ force: true });
  await expect(page.locator('main#main')).not.toBeFocused();

  // Back to the Admin's own account, on the card they started from.
  await banner.getByRole('button', { name: 'Back to my account' }).click();
  await expect(page).toHaveURL(`/admin/users/${managerId}/manage#sign-in-as`);
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

test('the account pages show whoever the Admin is signed in as, also when Next kept them', async ({
  page,
}) => {
  const managerId = await findUserId(STEP_UP_MANAGER.email);
  const banner = page.getByRole('region', { name: 'Signed in as someone else' });
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await signIn(page, PLATFORM_ADMIN);
  await openUserTab(page, STEP_UP_MANAGER.name, 'Manage');
  // The Admin's own Profile page, opened with a click, so Next keeps it alive with its fields.
  await openAccountSettings(page);
  await expect(name).toHaveValue(PLATFORM_ADMIN.name);
  await page.goBack();

  await page.getByRole('button', { name: 'Sign in as user' }).click();
  const dialog = page.getByRole('dialog', { name: `Sign in as ${STEP_UP_MANAGER.name}?` });
  await dialog.getByRole('button', { name: `Sign in as ${STEP_UP_MANAGER.name}` }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(banner).toBeVisible();

  // Signed in as the Manager, the Profile page shows the Manager, not what the Admin's held.
  await openAccountSettings(page);
  await expect(name).toHaveValue(STEP_UP_MANAGER.name);

  // Back in their own account, the Admin's Profile page shows the Admin again, not the Manager.
  await banner.getByRole('button', { name: 'Back to my account' }).click();
  await expect(page).toHaveURL(`/admin/users/${managerId}/manage#sign-in-as`);
  await expect(toasts(page)).toContainText("You're back in your own account.");
  await openAccountSettings(page);
  await expect(name).toHaveValue(PLATFORM_ADMIN.name);
});

test("the Admin's other tabs load afresh as the user, and back, without a click", async ({
  page,
  context,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  // Another tab of the same browser has the Admin's own Profile page, opened with a click, so Next
  // keeps it alive with their name.
  const other = await context.newPage();
  await useOwnClientIp(other);
  await other.goto('/dashboard');
  await openAccountSettings(other);
  const otherName = other.getByRole('textbox', { name: 'Name', exact: true });
  const otherBanner = other.getByRole('region', { name: 'Signed in as someone else' });
  await expect(otherName).toHaveValue(PLATFORM_ADMIN.name);

  await signInAsUser(page, STEP_UP_MANAGER.name);

  // Without a click, the other tab loads its page afresh as the Manager: the banner, their name,
  // and changes turned off outside requests.
  await expect(otherBanner).toBeVisible();
  await expect(other).toHaveURL('/account');
  await expect(otherName).toHaveValue(STEP_UP_MANAGER.name);
  await expect(otherName).toBeDisabled();

  // Back to the Admin's own account in the first tab: the other tab loads afresh as the Admin.
  await page
    .getByRole('region', { name: 'Signed in as someone else' })
    .getByRole('button', { name: 'Back to my account' })
    .click();
  await expect(otherBanner).toHaveCount(0);
  await expect(other).toHaveURL('/account');
  await expect(otherName).toHaveValue(PLATFORM_ADMIN.name);
  await expect(otherName).toBeEnabled();
});

test('the tab loads afresh as the Admin once the sign-in as a user has ended by itself', async ({
  page,
}) => {
  const banner = page.getByRole('region', { name: 'Signed in as someone else' });
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await signIn(page, PLATFORM_ADMIN);
  await signInAsUser(page, STEP_UP_MANAGER.name);
  // It ends in a few seconds instead of 30 minutes; the page counts down from when it loads.
  await endSignInAsSoon(PLATFORM_ADMIN.email, 6);
  await page.reload();
  await expect(banner).toBeVisible();

  // The Manager's Profile page, opened with a click, so Next keeps it alive with their name.
  await openAccountSettings(page);
  await expect(name).toHaveValue(STEP_UP_MANAGER.name);

  // Without a click, the same page loads afresh as the Admin once it has ended.
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await expect(toasts(page)).toContainText(
    "Signing in as the user has ended. You're back in your own account.",
  );
  await expect(page).toHaveURL('/account');
  await expect(name).toHaveValue(PLATFORM_ADMIN.name);
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
  await page.goto('/account/activity');
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
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
    `${COMPANY_OWNER.name} has to set up MFA before they can see anything else, so this Security page is what they see now.`,
  );
  await page.getByRole('button', { name: 'Back to my account' }).click();
  await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toHaveCount(0);
});

test('Support is told why they can’t sign in as someone', async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);

  await openUserTab(page, COMPANY_OWNER.name, 'Manage');
  await expect(page.getByText("Support can't sign in as a company Admin.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in as user' })).toBeDisabled();

  // A Watcher is within Support's reach, but this Support member has no strong MFA yet.
  await openUserTab(page, CLIENT_WATCHER.name, 'Manage');
  await expect(page.getByRole('link', { name: 'Security page' })).toHaveAttribute(
    'href',
    '/account/security#passkeys',
  );
  await expect(page.getByRole('button', { name: 'Sign in as user' })).toBeDisabled();
});

// Last in this file: it turns the Watcher's setting off for a moment, and back on.
test('a user turns sign-ins by staff off, which ends one under way and keeps staff out, and back on', async ({
  page,
  browser,
}) => {
  try {
    const card = page.locator('#staff-sign-in');
    const adminContext = await browser.newContext();
    try {
      // A staff Admin is signed in as the Watcher when the Watcher turns it off.
      const admin = await adminContext.newPage();
      await useOwnClientIp(admin);
      await signIn(admin, PLATFORM_ADMIN);
      await signInAsUser(admin, CLIENT_WATCHER.name);

      await signIn(page, CLIENT_WATCHER);
      await page.goto('/account/security');
      await expect(card.getByRole('heading', { name: 'Sign-ins by staff' })).toBeVisible();
      await card.getByRole('button', { name: 'Turn off' }).click();
      await expect(toasts(page)).toContainText('Sign-ins by staff turned off.');
      await expect(card).toContainText('Off');

      // The Admin's next page within the app ends it, and the tab loads afresh as the Admin.
      await openAccountSettings(admin);
      await expect(admin.getByRole('region', { name: 'Signed in as someone else' })).toHaveCount(0);
      await expect(toasts(admin)).toContainText(
        "Signing in as the user has ended. You're back in your own account.",
      );
      await expect(admin.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
        PLATFORM_ADMIN.name,
      );

      await openUserTab(admin, CLIENT_WATCHER.name, 'Manage');
      await expect(admin.getByText('This user has turned off sign-ins by staff.')).toBeVisible();
      await expect(admin.getByRole('button', { name: 'Sign in as user' })).toBeDisabled();
    } finally {
      await adminContext.close();
    }

    await card.getByRole('button', { name: 'Turn on' }).click();
    await expect(toasts(page)).toContainText('Sign-ins by staff turned on.');
    await expect(card).toContainText('On');
  } finally {
    // Whatever happened, the Watcher lets staff sign in again for the tests after this one.
    await allowStaffSignInOf(CLIENT_WATCHER.email);
  }
});
