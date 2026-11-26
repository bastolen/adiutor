/**
 * @file End-to-end tests for Settings: the staff's name, the request number
 * prefix, request types, where attached files are kept, inviting staff,
 * staff roles and the last-Admin guard, and confirming it's you before
 * giving a staff role or a company's Admin role. A test that changes a
 * setting puts it back.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Page } from '@playwright/test';

import { derivePalette, type HexColour, THEME_PALETTE } from '../src/lib/branding';
import { LOCALE_COOKIE } from '../src/lib/i18n/locales';
import expectAccessible from './support/axe';
import {
  attachmentSettingRows,
  backdateMfaConfirmation,
  restoreAttachmentSettings,
  restoreSmtpSetting,
  setBrandColours,
  setDefaultLocale,
  setDefaultTimeZone,
  setRequestPrefix,
  setStaffName,
  smtpSettingRow,
} from './support/db';
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
  searchSelect,
  sendInvitation,
  setUpAuthenticator,
  signIn,
  signOut,
  toasts,
  useOwnClientIp,
  invitationForm,
} from './support/helpers';
import { linkIn, waitForEmail, waitForEmailAbout } from './support/outbox';
import { expect, test } from './support/test';

test('an Admin changes the name shown to users', async ({ page }) => {
  try {
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

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
    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(name).toHaveValue(STAFF_NAME);
    await expect(page.getByRole('main').getByText('Name saved.')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL('/dashboard');
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Name saved.')).toHaveCount(0);
  } finally {
    await setStaffName(STAFF_NAME);
  }
});

/**
 * Reads the colour a token resolves to on the page in one mode, as the
 * browser computes it.
 *
 * @param page - The page.
 * @param token - The custom property, without `--`, e.g. `primary`.
 * @param scheme - The colour scheme to read it in.
 * @returns E.g. `rgb(194, 24, 91)`.
 */
async function shownColour(page: Page, token: string, scheme: 'light' | 'dark'): Promise<string> {
  return page.evaluate(
    ({ name, colourScheme }) => {
      const probe = document.createElement('span');
      probe.style.colorScheme = colourScheme;
      probe.style.color = `var(--${name})`;
      document.body.append(probe);
      const { color } = getComputedStyle(probe);
      probe.remove();
      return color;
    },
    { name: token, colourScheme: scheme },
  );
}

/**
 * Writes a hex colour the way the browser computes colours.
 *
 * @param hex - The colour, as `#rrggbb`.
 * @returns E.g. `rgb(194, 24, 91)`.
 */
function rgbOf(hex: HexColour): string {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

test('an Admin chooses the brand colours, which every page shows', async ({ page, browser }) => {
  const chosen = { accent: '#c2185b', accentDark: null, tint: '#2e7d32' } as const;
  const palette = derivePalette(chosen);
  try {
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/admin/settings/appearance');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    const accent = page.getByRole('textbox', { name: 'Accent', exact: true });
    const accentDark = page.getByRole('textbox', { name: 'Accent in dark mode', exact: true });
    await expect(accent).toHaveValue('');
    expect(await shownColour(page, 'primary', 'light')).toBe(rgbOf(THEME_PALETTE.light.primary));

    // A dark accent needs an accent; refused, what was typed stays.
    await accentDark.fill('#ff80ab');
    await page.getByRole('button', { name: 'Save colours' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Choose an accent before an accent for dark mode.',
    );
    await expect(accentDark).toHaveValue('#ff80ab');

    await accentDark.fill('');
    await accent.fill('C2185B');
    await page.getByRole('textbox', { name: 'Tint', exact: true }).fill(chosen.tint);
    await page.getByRole('button', { name: 'Save colours' }).click();
    await expect(toasts(page)).toContainText('Colours saved.');
    await expect(accent).toHaveValue(chosen.accent);

    // This page shows them at once, in both modes, and so does every other page.
    await expect
      .poll(() => shownColour(page, 'primary', 'light'))
      .toBe(rgbOf(palette.palette.light.primary));
    expect(await shownColour(page, 'primary', 'dark')).toBe(rgbOf(palette.palette.dark.primary));
    expect(await shownColour(page, 'surface', 'dark')).toBe(rgbOf(palette.palette.dark.surface));
    await expectAccessible(page);
    await page.goto('/dashboard');
    expect(await shownColour(page, 'background', 'light')).toBe(
      rgbOf(palette.palette.light.background),
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectAccessible(page);

    // Signed out too, the brand panel included.
    const signedOut = await browser.newPage();
    try {
      await signedOut.goto('/auth');
      expect(await shownColour(signedOut, 'primary', 'light')).toBe(
        rgbOf(palette.palette.light.primary),
      );
      expect(await shownColour(signedOut, 'brand-panel', 'light')).toBe(
        rgbOf(palette.panel.background),
      );
    } finally {
      await signedOut.close();
    }

    // Back to Adiutor's own: the page has no colours of its own any more.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/admin/settings/appearance');
    await page.getByRole('button', { name: 'Use Adiutor’s colours' }).click();
    await expect(accent).toHaveValue('');
    await page.getByRole('button', { name: 'Save colours' }).click();
    await expect(toasts(page)).toContainText('Colours saved.');
    await expect
      .poll(() => shownColour(page, 'primary', 'light'))
      .toBe(rgbOf(THEME_PALETTE.light.primary));
    await expect(page.locator('head style', { hasText: ':root:root' })).toHaveCount(0);
  } finally {
    await setBrandColours();
  }
});

test('an Admin chooses the prefix request numbers are shown with', async ({ page }) => {
  try {
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/admin/settings/requests');

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
  } finally {
    await setRequestPrefix('AD');
  }
});

test('an Admin chooses a folder for attached files, which is tried first, turns attaching on and chooses the largest file', async ({
  page,
}) => {
  const before = await attachmentSettingRows();
  const folder = await mkdtemp(join(tmpdir(), 'adiutor-e2e-files-'));
  try {
    await restoreAttachmentSettings([]);
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/admin/settings/attachments');
    await expect(
      page.getByText('No storage is chosen yet, so nobody can attach files.'),
    ).toBeVisible();
    // Attaching can only be turned on once there's a storage.
    const attaching = page.getByRole('checkbox', { name: 'People can attach files' });
    await expect(attaching).toBeDisabled();
    await expect(attaching).toHaveAccessibleDescription('Choose where files are kept first.');

    await page.getByRole('combobox', { name: 'Storage' }).click();
    await page.getByRole('option', { name: /A folder on this server/ }).click();
    const dir = page.getByRole('textbox', { name: 'Folder' });

    // A folder that isn't there fails its test, and what was typed stays.
    await dir.fill(join(folder, 'missing'));
    await page.getByRole('button', { name: 'Test and save' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      "The bucket or the folder doesn't exist. Create it first.",
    );
    await expect(dir).toHaveValue(join(folder, 'missing'));

    await dir.fill(folder);
    await page.getByRole('button', { name: 'Test and save' }).click();
    await expect(toasts(page)).toContainText('Storage saved.');
    await expect(page.getByText('No storage is chosen yet')).toBeHidden();
    await expect(dir).toHaveValue(folder);
    // The test file is gone; the marker stays.
    expect(await readdir(folder)).toContain('.adiutor-attachments');

    await attaching.check();
    await page
      .getByRole('region', { name: 'Attaching files' })
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(toasts(page)).toContainText('People can attach files now.');

    const megabytes = page.getByRole('spinbutton', { name: 'Megabytes' });
    await expect(megabytes).toHaveAccessibleDescription('From 1 to 50.');
    await megabytes.fill('20');
    await page.getByRole('button', { name: 'Save size' }).click();
    await expect(toasts(page)).toContainText('Largest file saved.');
    await page.reload();
    await expect(megabytes).toHaveValue('20');
    await expect(attaching).toBeChecked();
  } finally {
    await restoreAttachmentSettings(before);
    await rm(folder, { recursive: true, force: true });
  }
});

test('an Admin sets up the mail server, which is tried with a test email first', async ({
  page,
}) => {
  const before = await smtpSettingRow();
  try {
    await restoreSmtpSetting(null);
    await signIn(page, PLATFORM_ADMIN);
    await page.goto('/admin/settings/email');
    // The tests' server runs in production, where a missing mail server means no sign-in links.
    await expect(
      page.getByText(
        'No mail server is set up yet: until one is, nobody gets sign-in links, password resets or invitations.',
      ),
    ).toBeVisible();

    const host = page.getByRole('textbox', { name: 'Server' });
    await host.fill('smtp.adiutor.test');
    await page.getByRole('combobox', { name: 'Security' }).click();
    await page.getByRole('option', { name: /^None/ }).click();
    await page.getByRole('textbox', { name: 'Username' }).fill('mailer@adiutor.test');
    await page.getByLabel('Password').fill('e2e-mail-password');
    await page.getByRole('textbox', { name: 'Sender name' }).fill('Adiutor Tests');
    await page.getByRole('textbox', { name: 'Sender address' }).fill('no-reply@adiutor.test');

    // Without TLS to another computer, production refuses it, and what was typed stays.
    await page.getByRole('button', { name: 'Test and save' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Use TLS or STARTTLS: without them, the emails and the sign-in links in them would travel unencrypted.',
    );
    await expect(host).toHaveValue('smtp.adiutor.test');

    await page.getByRole('combobox', { name: 'Security' }).click();
    await page.getByRole('option', { name: /^STARTTLS/ }).click();
    await page.getByLabel('Password').fill('e2e-mail-password');
    await page.getByRole('button', { name: 'Test and save' }).click();
    await expect(toasts(page)).toContainText(
      'Mail server saved. A test email reached you through it.',
    );

    // The test email went to the Admin (the tests' outbox stands in for the mail server), and so
    // did the notice every staff Admin gets, the one who saved it too.
    const testEmail = await waitForEmailAbout(
      PLATFORM_ADMIN.email,
      'Adiutor can send email through this mail server',
    );
    expect(testEmail.text).toContain('smtp.adiutor.test:587');
    const notice = await waitForEmailAbout(
      PLATFORM_ADMIN.email,
      'Adiutor sends email through another mail server',
    );
    expect(notice.text).toContain('smtp.adiutor.test:587');

    // Saved without the password, which is emptied and never shown again.
    await page.reload();
    await expect(host).toHaveValue('smtp.adiutor.test');
    await expect(page.getByRole('spinbutton', { name: 'Port' })).toHaveValue('587');
    const password = page.getByLabel('Password');
    await expect(password).toHaveValue('');
    await expect(password).toHaveAccessibleDescription(
      'A password is saved. Leave this empty to keep it while the server, port and username stay the same.',
    );
    await expect(page.getByText('No mail server is set up yet')).toBeHidden();
  } finally {
    await restoreSmtpSetting(before);
  }
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
  await page.goto('/admin/settings/requests');
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
  await page.goto('/admin/settings/requests');
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
  await page.goto('/admin/settings');
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
  await page.goto('/admin/settings');
  try {
    const select = page.getByRole('combobox', { name: 'Default time zone' });
    await expect(select).toContainText('UTC');
    await searchSelect(select, 'tokyo');
    await page.keyboard.press('Enter');
    await expect(select).toContainText('Tokyo');
    await page.getByRole('button', { name: 'Save default time zone' }).click();
    await expect(toasts(page)).toContainText('Default time zone saved.');
    // The select shows the zone just saved, not the one from before the save.
    await expect(select).toContainText('Tokyo');
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Default time zone' })).toContainText('Tokyo');
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
  await page.goto('/admin/settings');
  // Someone who chose Spanish on the sign-in page.
  const visitor = await browser.newContext({ locale: 'en-US' });
  await visitor.addCookies([{ name: LOCALE_COOKIE, value: 'es-ES', url: E2E_BASE_URL }]);
  /**
   * Saves the Languages card, and waits until the save is through.
   */
  const save = async () => {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/admin/settings'),
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
  await page.goto('/admin/settings/staff');

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
  await page.goto('/admin/settings/staff');
  await sendInvitation(page, email, 'Admin');
  await expect(toasts(page)).toContainText(`Invitation sent to ${email}.`);

  // They join and set up MFA, as staff Admins must.
  const admin = await (await browser.newContext()).newPage();
  // Its own client IP, so its sign-in doesn't count towards the limits of the page's.
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
  await admin.goto('/admin/settings/staff');
  const ownRow = admin.getByRole('row').filter({ has: admin.getByText('You', { exact: true }) });
  await expect(ownRow.getByRole('button', { name: 'Leave the staff' })).toBeVisible();
  await ownRow.getByRole('combobox', { name: 'Role of Second Admin' }).click();
  await admin.getByRole('option', { name: 'Manager' }).click();
  const dialog = admin.getByRole('alertdialog', { name: 'Step down to Manager?' });
  await expect(dialog).toContainText("You can't raise your own role again");
  await dialog.getByRole('button', { name: 'Step down' }).click();

  // Not the staff settings' 404: the dashboard, saying what happened.
  await expect(admin).toHaveURL('/dashboard?notice=stepped-down');
  await expect(
    admin.getByRole('status').filter({ hasText: 'You stepped down from staff Admin.' }),
  ).toBeVisible();
  await admin.goto('/admin/settings/staff');
  await expect(admin.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await admin.context().close();
});

test('an Admin creates a staff invite link that someone uses', async ({ page, browser }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/settings/staff');

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
  await signIn(page, PLATFORM_ADMIN);
  const confirm = /^Confirm it.s you$/;

  // Confirmed just now: invite someone to the staff, to resend once the confirmation is old.
  const email = freshAddress('resend.support');
  await page.goto('/admin/settings/staff');
  const staffInvite = invitationForm(page);
  await sendInvitation(page, email, 'Support');
  await expect(toasts(page)).toContainText(`Invitation sent to ${email}.`);

  // Signed in 20 minutes ago, as far as the confirmation window goes.
  await backdateMfaConfirmation(PLATFORM_ADMIN.email, 20);

  // Every staff role needs it: the invite form asks before anything is typed, and the step-up
  // page comes back to the form's card.
  await page.goto('/admin/settings/staff');
  await expect(staffInvite.getByRole('button', { name: 'Send invitations' })).toHaveCount(0);
  await expect(staffInvite.getByRole('link', { name: confirm })).toHaveAttribute(
    'href',
    '/auth/verify?callbackURL=%2Fadmin%2Fsettings%2Fstaff%23invite&for=change',
  );

  // In a company only the Admin role does: Client and Watcher invitations can be sent.
  // At the address the app links to (its URL name), which the step-up page returns to.
  const membersPath = `/companies/${COMPANY_SLUG}/members`;
  await page.goto(membersPath);
  const companyInvite = invitationForm(page);
  await expect(companyInvite.getByRole('button', { name: 'Send invitations' })).toBeVisible();
  await companyInvite.getByRole('combobox', { name: 'Role', exact: true }).click();
  await page.getByRole('option', { name: /^Admin/ }).click();
  await expect(companyInvite.getByRole('button', { name: 'Send invitations' })).toHaveCount(0);

  // The step-up page, in change mode, coming back to the Members page's invite form.
  await companyInvite.getByRole('link', { name: confirm }).click();
  await expect(page).toHaveURL(
    `/auth/verify?callbackURL=${encodeURIComponent(`${membersPath}#company-invite`)}&for=change`,
  );
  await expect(page.getByRole('heading', { name: confirm })).toBeVisible();

  // "Resend" asks only once the service refuses, and still comes back to the open invitations.
  await page.goto('/admin/settings/staff');
  const resend = page.getByRole('button', { name: `Resend invitation to ${email}` });
  await resend.click();
  await expect(page).toHaveURL(
    '/auth/verify?callbackURL=%2Fadmin%2Fsettings%2Fstaff%23invitations&for=change',
  );
  await confirmWithAuthenticator(page, PLATFORM_ADMIN.totpSecret);

  // Back on the card where they clicked: scrolled to, with focus on its heading.
  await expect(page).toHaveURL('/admin/settings/staff#invitations', { timeout: 15_000 });
  const invitations = page.getByRole('heading', { name: 'Open invitations' });
  await expect(invitations).toBeFocused();
  await expect(invitations).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // Confirmed just now, it goes ahead.
  await resend.click();
  await expect(toasts(page)).toContainText(`Invitation sent to ${email} again.`);
});
