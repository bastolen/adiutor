/**
 * @file End-to-end tests for the staff page: renaming the staff, choosing the
 * prefix of request numbers, managing request types (and raising a request
 * with one, until it's archived), inviting staff by email and by invite link, changing staff roles with the
 * last-Admin guard, a staff Admin stepping down themselves, and confirming
 * it's you before giving a staff role or a company's Admin role, coming back
 * to the card where you clicked.
 */
import { randomUUID } from 'node:crypto';

import { backdateMfaConfirmation, setDefaultLocale, setDefaultTimeZone } from './support/db';
import {
  COMPANY_SLUG,
  E2E_BASE_URL,
  PLATFORM_ADMIN,
  REQUESTS_CLIENT,
  STAFF_NAME,
} from './support/fixtures';
import {
  confirmWithAuthenticator,
  createAccountFromInvitation,
  createInviteLink,
  freshAddress,
  sendInvitation,
  setUpAuthenticator,
  signIn,
  signOut,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { linkIn, waitForEmail } from './support/outbox';
import { expect, test } from './support/test';
import { codeForSecret } from './support/totp';

test('an Admin changes the name shown to users', async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');
  await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();

  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toHaveValue(STAFF_NAME);
  await name.fill('Adiutor Tests Support');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(toasts(page)).toContainText('Name saved.');
  await page.reload();
  await expect(name).toHaveValue('Adiutor Tests Support');

  // Put it back for the other tests.
  await name.fill(STAFF_NAME);
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(toasts(page)).toContainText('Name saved.');

  // Next.js keeps the page alive on navigation, but it shows no message of its own when you come
  // back (the toast goes away on its own).
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL('/dashboard');
  await nav.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  await expect(name).toHaveValue(STAFF_NAME);
  await expect(page.getByRole('main').getByText('Name saved.')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL('/dashboard');
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Name saved.')).toHaveCount(0);
});

test('an Admin chooses the prefix request numbers are shown with', async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');

  const prefix = page.getByRole('textbox', { name: 'Prefix' });
  await expect(prefix).toHaveValue('AD');
  await expect(prefix).toHaveAccessibleDescription('Requests are shown as AD-142.');

  // Anything but letters and digits is refused, and what was typed stays.
  await prefix.fill('a-d');
  await page.getByRole('button', { name: 'Save prefix' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Use one to five letters or digits for the prefix',
  );
  await expect(prefix).toHaveValue('a-d');

  // Typed in lower case, saved in capitals.
  await prefix.fill('help');
  await page.getByRole('button', { name: 'Save prefix' }).click();
  await expect(toasts(page)).toContainText('Prefix saved.');
  await expect(prefix).toHaveValue('HELP');
  await expect(prefix).toHaveAccessibleDescription('Requests are shown as HELP-142.');
  await page.reload();
  await expect(prefix).toHaveValue('HELP');

  // Put it back for the other tests.
  await prefix.fill('AD');
  await page.getByRole('button', { name: 'Save prefix' }).click();
  await expect(toasts(page)).toContainText('Prefix saved.');
  await expect(prefix).toHaveValue('AD');
});

test('an Admin adds a request type, which a company raises requests with until it’s archived', async ({
  page,
}) => {
  // A name of this run's own: types are never deleted, so a run that's retried adds another.
  const run = randomUUID().slice(0, 6);
  const added = `Label printers ${run}`;
  const renamed = `Labels ${run}`;
  const card = page.getByRole('region', { name: 'Request types' });
  const types = card.getByRole('list', { name: 'Request types' }).getByRole('listitem');

  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');
  await card.getByRole('button', { name: 'Add type' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a request type' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(added);
  await dialog.getByRole('textbox', { name: 'What it’s for' }).fill('A label printer acts up.');
  await dialog.getByRole('combobox', { name: 'Starting priority' }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await dialog.getByRole('button', { name: 'Add type' }).click();
  await expect(toasts(page)).toContainText('Type added.');
  // At the end, with what it's for and its starting priority.
  await expect(types.last()).toContainText(added);
  await expect(types.last()).toContainText('A label printer acts up.');
  await expect(types.last()).toContainText('High priority');

  // A new name keeps the type; moving it swaps it with its neighbour, and back.
  await card.getByRole('button', { name: `Edit ${added}` }).click();
  const edit = page.getByRole('dialog', { name: `Edit ${added}` });
  await edit.getByRole('textbox', { name: 'Name' }).fill(renamed);
  await edit.getByRole('button', { name: 'Save type' }).click();
  await expect(toasts(page)).toContainText('Type saved.');
  await expect(types.last()).toContainText(renamed);
  await card.getByRole('button', { name: `Move ${renamed} up` }).click();
  await expect(types.last()).not.toContainText(renamed);
  await expect(types.nth(-2)).toContainText(renamed);
  await card.getByRole('button', { name: `Move ${renamed} down` }).click();
  await expect(types.last()).toContainText(renamed);
  // The last type can't go down: the button is off, and keeps focus.
  await expect(card.getByRole('button', { name: `Move ${renamed} down` })).toBeFocused();
  await expect(card.getByRole('button', { name: `Move ${renamed} down` })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await signOut(page);

  // Someone at a company raises a request with it, and sees what it's for.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto('/requests/new');
  await page.getByRole('textbox', { name: 'Title' }).fill(`The label printer ${run} jams`);
  await page.getByRole('textbox', { name: 'Description' }).fill('Every third label.');
  await page.getByRole('combobox', { name: 'Type' }).click();
  await expect(page.getByRole('option', { name: renamed })).toContainText(
    'A label printer acts up.',
  );
  await page.getByRole('option', { name: renamed }).click();
  await page.getByRole('button', { name: 'Raise request' }).click();
  await expect(toasts(page)).toContainText('Request raised.');
  const requestUrl = page.url();
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText(renamed);
  await signOut(page);

  // Archived, it's no longer offered; the request keeps it.
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');
  await card.getByRole('button', { name: `Archive ${renamed}` }).click();
  const confirm = page.getByRole('alertdialog', { name: `Archive ${renamed}?` });
  await confirm.getByRole('button', { name: 'Archive type' }).click();
  await expect(toasts(page)).toContainText(`${renamed} archived.`);
  await expect(types.last()).toContainText('Archived');
  await expect(card.getByRole('button', { name: `Restore ${renamed}` })).toBeVisible();
  await signOut(page);

  await signIn(page, REQUESTS_CLIENT);
  await page.goto('/requests/new');
  await page.getByRole('combobox', { name: 'Type' }).click();
  await expect(page.getByRole('option', { name: /^Bug/ })).toBeVisible();
  await expect(page.getByRole('option', { name: renamed })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto(requestUrl);
  await expect(details).toContainText(renamed);
});

test("an Admin changes Adiutor's default language, which visitors without a choice get", async ({
  browser,
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');
  try {
    const select = page.getByRole('combobox', { name: 'Default language' });
    await expect(select).toHaveText('English (US)');
    await select.click();
    await page.getByRole('option', { name: 'Español' }).click();
    await page.getByRole('button', { name: 'Save languages' }).click();
    await expect(toasts(page)).toContainText('Languages saved.');
    // The Admin hasn't chosen a language of their own (they're on Default), so they follow it too.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    // The select shows the language just saved, not the one from before the save.
    await expect(page.getByRole('combobox', { name: 'Idioma predeterminado' })).toHaveText(
      'Español',
    );

    // Someone without a choice gets Spanish, whatever their browser asks for.
    const visitor = await browser.newContext({ locale: 'nl-NL' });
    try {
      const other = await visitor.newPage();
      await other.goto('/auth');
      await expect(other.locator('html')).toHaveAttribute('lang', 'es-ES');
      await expect(
        other.getByRole('button', { name: 'Tema e idioma: Sistema, Español' }),
      ).toBeVisible();
    } finally {
      await visitor.close();
    }
  } finally {
    // Put it back for the other tests, even if a step failed.
    await setDefaultLocale('en-US');
  }
});

test("an Admin changes Adiutor's default time zone", async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');
  try {
    const select = page.getByRole('combobox', { name: 'Default time zone' });
    await expect(select).toContainText('UTC');
    await select.click();
    await page.getByRole('option', { name: /^Asia\/Tokyo/ }).click();
    await page.getByRole('button', { name: 'Save default time zone' }).click();
    await expect(toasts(page)).toContainText('Default time zone saved.');
    // The select shows the zone just saved, not the one from before the save.
    await expect(select).toContainText('Asia/Tokyo');
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Default time zone' })).toContainText(
      'Asia/Tokyo',
    );
  } finally {
    // Put it back for the other tests, even if a step failed.
    await setDefaultTimeZone('UTC');
  }
});

test('an Admin turns languages off, which nobody is offered or gets until they’re on again', async ({
  browser,
  page,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');
  // Someone who chose Spanish on the sign-in page.
  const visitor = await browser.newContext({ locale: 'en-US' });
  await visitor.addCookies([{ name: 'adiutor.locale', value: 'es-ES', url: E2E_BASE_URL }]);
  /**
   * Saves the Languages card, and waits until the save is through.
   */
  const save = async () => {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/admin/staff'),
    );
    await page.getByRole('button', { name: 'Save languages' }).click();
    await saved;
    await expect(toasts(page)).toContainText('Languages saved.');
  };
  try {
    const other = await visitor.newPage();
    await other.goto('/auth');
    await expect(other.locator('html')).toHaveAttribute('lang', 'es-ES');

    await page.getByRole('checkbox', { name: 'Español' }).uncheck();
    await save();
    // Their choice now counts as Default: the default language, and Spanish isn't offered.
    await other.reload();
    await expect(other.locator('html')).toHaveAttribute('lang', 'en-US');
    await other.getByRole('button', { name: 'Theme and language: System, English (US)' }).click();
    await expect(other.getByRole('menuitemradio', { name: 'Default' })).toBeChecked();
    await expect(other.getByRole('menuitemradio', { name: 'Español' })).toHaveCount(0);
    await other.keyboard.press('Escape');

    // With only English left, there's no language to choose.
    await expect(page.getByRole('checkbox', { name: 'English (US)' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Nederlands' }).uncheck();
    await save();
    await other.reload();
    await other.getByRole('button', { name: 'Theme: System' }).click();
    await expect(other.getByRole('menuitemradio', { name: 'English (US)' })).toHaveCount(0);
    await other.keyboard.press('Escape');

    // Back on, their choice counts again.
    await page.getByRole('checkbox', { name: 'Español' }).check();
    await save();
    await other.reload();
    await expect(other.locator('html')).toHaveAttribute('lang', 'es-ES');
  } finally {
    await visitor.close();
    // Put them back for the other tests, even if a step failed.
    await setDefaultLocale('en-US');
  }
});

test('an Admin invites a Manager by email, changes their role, and keeps an Admin', async ({
  page,
  browser,
}) => {
  const email = freshAddress('new.manager');
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');

  await sendInvitation(page, email, 'Manager');
  await expect(toasts(page)).toContainText(`Invitation sent to ${email}.`);

  // They accept with a new account and land on setting up MFA, as Managers must.
  const invited = await (await browser.newContext()).newPage();
  const invitation = await waitForEmail(email);
  expect(invitation.subject).toBe(`E2E Admin invited you to join ${STAFF_NAME} on Adiutor`);
  await invited.goto(linkIn(invitation));
  await expect(invited.getByRole('heading', { name: `Join ${STAFF_NAME}` })).toBeVisible();
  await createAccountFromInvitation(
    invited,
    'New Manager',
    'new-manager-password',
    '/account/security?setup=required',
  );
  await invited.context().close();

  // The Admin sees them on the staff and makes them Finance.
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: email });
  await row.getByRole('combobox', { name: 'Role of New Manager' }).click();
  await page.getByRole('option', { name: 'Finance' }).click();
  await expect(toasts(page)).toContainText('Staff role saved.');

  // The only Admin can't step down: asked first, then refused.
  const adminRow = page.getByRole('row').filter({ hasText: PLATFORM_ADMIN.email });
  await adminRow.getByRole('combobox', { name: `Role of ${PLATFORM_ADMIN.name}` }).click();
  await page.getByRole('option', { name: 'Manager' }).click();
  await page
    .getByRole('alertdialog', { name: 'Step down to Manager?' })
    .getByRole('button', { name: 'Step down' })
    .click();
  await expect(adminRow.getByRole('alert')).toHaveText(
    'There must always be at least one staff Admin. Make someone else an Admin first.',
  );
});

test('a second staff Admin steps down after a confirmation, and lands on the dashboard', async ({
  page,
  browser,
}) => {
  const email = freshAddress('second.admin');
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');
  await sendInvitation(page, email, 'Admin');
  await expect(toasts(page)).toContainText(`Invitation sent to ${email}.`);

  // They join and set up MFA, as staff Admins must.
  const admin = await (await browser.newContext()).newPage();
  // Its own client IP, so Better Auth's per-IP limits don't carry over from the tests before it.
  await useOwnClientIp(admin);
  await admin.goto(linkIn(await waitForEmail(email)));
  await createAccountFromInvitation(
    admin,
    'Second Admin',
    'second-admin-password',
    '/account/security?setup=required',
  );
  await setUpAuthenticator(admin, 'second-admin-password');

  // On their own row, the select asks first, in their own words.
  await admin.goto('/admin/staff');
  const ownRow = admin.getByRole('row').filter({ has: admin.getByText('You', { exact: true }) });
  await expect(ownRow.getByRole('button', { name: 'Leave the staff' })).toBeVisible();
  await ownRow.getByRole('combobox', { name: 'Role of Second Admin' }).click();
  await admin.getByRole('option', { name: 'Manager' }).click();
  const dialog = admin.getByRole('alertdialog', { name: 'Step down to Manager?' });
  await expect(dialog).toContainText("You can't raise your own role again");
  await dialog.getByRole('button', { name: 'Step down' }).click();

  // Not the staff page's 404: the dashboard, saying what happened.
  await expect(admin).toHaveURL('/dashboard?notice=stepped-down');
  await expect(
    admin.getByRole('status').filter({ hasText: 'You stepped down from staff Admin.' }),
  ).toBeVisible();
  await admin.goto('/admin/staff');
  await expect(admin.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await admin.context().close();
});

test('an Admin creates a staff invite link that someone uses', async ({ page, browser }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/staff');

  const inviteLink = await createInviteLink(page, 'Support');
  expect(inviteLink).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);

  const email = freshAddress('linked.staff');
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(inviteLink);
  await expect(visitor.getByRole('heading', { name: `Join ${STAFF_NAME}` })).toBeVisible();
  await visitor.getByLabel('Email').fill(email);
  await visitor.getByRole('button', { name: 'Continue' }).click();
  await expect(visitor.getByRole('status')).toContainText(`we've sent an email to ${email}`);
  expect((await waitForEmail(email)).subject).toContain(`join ${STAFF_NAME}`);
  await visitor.context().close();
});

test('an Admin who confirmed long ago confirms it’s them before giving staff or Admin roles', async ({
  page,
}) => {
  // Waits for the next authenticator code (up to 30 seconds) on top of the sign-in.
  test.setTimeout(120_000);
  await signIn(page, PLATFORM_ADMIN);
  // The code just used to sign in (or an earlier one); confirming again needs a later one.
  const signInCode = codeForSecret(PLATFORM_ADMIN.totpSecret);
  const confirm = /^Confirm it.s you$/;

  // Confirmed just now: invite someone to the staff, to resend once the confirmation is old.
  const email = freshAddress('resend.support');
  await page.goto('/admin/staff');
  const staffInvite = page.locator('form').filter({ has: page.getByLabel('Email addresses') });
  await staffInvite.getByLabel('Email addresses').fill(email);
  await staffInvite.getByRole('combobox', { name: 'Role', exact: true }).click();
  await page.getByRole('option', { name: 'Support' }).click();
  await staffInvite.getByRole('button', { name: 'Send invitations' }).click();
  await expect(toasts(page)).toContainText(`Invitation sent to ${email}.`);

  // Signed in 20 minutes ago, as far as the confirmation window goes.
  await backdateMfaConfirmation(PLATFORM_ADMIN.email, 20);

  // Every staff role needs it: the invite form asks before anything is typed, and the step-up
  // page comes back to the form's card.
  await page.goto('/admin/staff');
  await expect(staffInvite.getByRole('button', { name: 'Send invitations' })).toHaveCount(0);
  await expect(staffInvite.getByRole('link', { name: confirm })).toHaveAttribute(
    'href',
    '/auth/verify?callbackURL=%2Fadmin%2Fstaff%23invite&for=change',
  );

  // In a company only the Admin role does: Client and Watcher invitations can be sent.
  // At the address the app links to (its URL name), which the step-up page returns to.
  const membersPath = `/companies/${COMPANY_SLUG}/members`;
  await page.goto(membersPath);
  const companyInvite = page.locator('form').filter({ has: page.getByLabel('Email addresses') });
  await expect(companyInvite.getByRole('button', { name: 'Send invitations' })).toBeVisible();
  await companyInvite.getByRole('combobox', { name: 'Role', exact: true }).click();
  await page.getByRole('option', { name: /^Admin/ }).click();
  await expect(companyInvite.getByRole('button', { name: 'Send invitations' })).toHaveCount(0);

  // The step-up page, in change mode, coming back to the Members page's invite form.
  await companyInvite.getByRole('link', { name: confirm }).click();
  await expect(page).toHaveURL(
    `/auth/verify?callbackURL=${encodeURIComponent(`${membersPath}#invite`)}&for=change`,
  );
  await expect(page.getByRole('heading', { name: confirm })).toBeVisible();

  // "Resend" asks only once the service refuses, and still comes back to the open invitations.
  await page.goto('/admin/staff');
  const resend = page.getByRole('button', { name: `Resend invitation to ${email}` });
  await resend.click();
  await expect(page).toHaveURL(
    '/auth/verify?callbackURL=%2Fadmin%2Fstaff%23invitations&for=change',
  );
  // An authenticator code can't be used twice, so wait for the next one.
  await expect
    .poll(() => codeForSecret(PLATFORM_ADMIN.totpSecret), { timeout: 35_000, intervals: [1_000] })
    .not.toBe(signInCode);
  await confirmWithAuthenticator(page, PLATFORM_ADMIN.totpSecret);

  // Back on the card where they clicked: scrolled to, with focus on its heading.
  await expect(page).toHaveURL('/admin/staff#invitations', { timeout: 15_000 });
  const invitations = page.getByRole('heading', { name: 'Open invitations' });
  await expect(invitations).toBeFocused();
  await expect(invitations).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // Confirmed just now, it goes ahead.
  await resend.click();
  await expect(toasts(page)).toContainText(`Invitation sent to ${email} again.`);
});
