/**
 * @file End-to-end tests for choosing the language: what the browser asks
 * for, the theme and language menu on the signed-out pages, the account's language
 * (saved, kept at sign-out, winning at sign-in), a language left in the
 * browser (never saved with an account on Default, and removed at sign-in),
 * the theme and language menu on a page reached signed in (saved with the
 * account) and an invitation sent in the language its sender picked. Specs
 * that sign in here use fresh accounts, so the seeded users keep English (US)
 * for the other specs.
 */
import { type Page } from '@playwright/test';

import { LOCALE_COOKIE } from '../src/lib/i18n/locales';
import { findCompanyId, setDefaultLocale, storeInvitation } from './support/db';
import { COMPANY_NAME, COMPANY_SLUG, E2E_BASE_URL, PLATFORM_ADMIN } from './support/fixtures';
import {
  createAccountFromInvitation,
  freshAddress,
  signIn,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { waitForEmail } from './support/outbox';
import { expect, test } from './support/test';

/**
 * Chooses a language in the floating language menu of a signed-out page and
 * waits for the page to come back in it.
 *
 * @param page - The browser page, on a signed-out page.
 * @param current - The menu button's name now, e.g. "Theme and language: System, English (US)".
 * @param language - The language to choose, named in itself.
 * @param lang - Its locale, which `<html lang>` then says.
 */
async function chooseLanguage(page: Page, current: string, language: string, lang: string) {
  await page.getByRole('button', { name: current }).click();
  await page.getByRole('menuitemradio', { name: language }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

/**
 * Chooses a language on the account's Language card and saves it.
 *
 * @param page - The browser page, on the account page.
 * @param label - The select's label, in the page's language now.
 * @param language - The language to choose, named in itself (or Default, by a pattern, as its
 *   name includes its description).
 * @param save - The save button's name, in the page's language now.
 */
async function saveAccountLanguage(
  page: Page,
  label: string,
  language: string | RegExp,
  save: string,
) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: language }).click();
  await page.getByRole('button', { name: save }).click();
}

test.describe('a browser that asks for Dutch', () => {
  test.use({ locale: 'nl-NL' });

  test("gets Adiutor's default language until it chooses one", async ({ page }) => {
    // Adiutor's default (English (US) in the tests) comes before what the browser asks for.
    await page.goto('/auth');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');

    await chooseLanguage(page, 'Theme and language: System, English (US)', 'Nederlands', 'nl-NL');
    await expect(page.getByRole('heading', { name: 'Inloggen bij Adiutor' })).toBeVisible();
  });
});

test('the theme and language menu on the sign-in page remembers the choice', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');

  await chooseLanguage(page, 'Theme and language: System, English (US)', 'Español', 'es-ES');
  await expect(page.getByRole('heading', { name: 'Inicia sesión en Adiutor' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Inicia sesión en Adiutor' })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.find(({ name }) => name === LOCALE_COOKIE)?.value).toBe('es-ES');

  // Default forgets the choice: the page follows Adiutor's default language again.
  await chooseLanguage(page, 'Tema e idioma: Sistema, Español', 'Predeterminado', 'en-US');
  await expect(page.getByRole('heading', { name: 'Sign in to Adiutor' })).toBeVisible();
  const after = await page.context().cookies();
  expect(after.find(({ name }) => name === LOCALE_COOKIE)).toBeUndefined();
});

test("an account's language: saved on the account page, kept at sign-out, winning at sign-in", async ({
  browser,
  page,
}) => {
  const email = freshAddress('language');
  const password = 'language-test-password';
  const companyId = await findCompanyId(COMPANY_SLUG);
  await page.goto(await storeInvitation({ companyId, email, role: 'client' }));
  await createAccountFromInvitation(page, 'Language Tester', password);

  await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  // A new account follows Adiutor's default language until it chooses one.
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveText('Default');
  await saveAccountLanguage(page, 'Language', 'Nederlands', 'Save language');

  // The page reloads in Dutch, on the Language card, and says it's saved, once: what asked for
  // that leaves the address, the card stays in it.
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl-NL');
  await expect(page.getByRole('heading', { name: 'Taal', exact: true })).toBeVisible();
  await expect(toasts(page)).toContainText('Taal opgeslagen.');
  await expect(page).toHaveURL(/\/account#language$/);

  // A second change reloads just the same, the button usable again.
  await saveAccountLanguage(page, 'Taal', 'Español', 'Taal opslaan');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
  await expect(page.getByRole('heading', { name: 'Idioma', exact: true })).toBeVisible();
  await expect(toasts(page)).toContainText('Idioma guardado.');
  await expect(page.getByRole('button', { name: 'Guardar idioma' })).toBeEnabled();
  // Pages visited before the change are in Spanish too.
  await page.getByRole('link', { name: 'Panel de Adiutor' }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');

  // Signing out keeps the browser's language for the sign-in page.
  await page.getByRole('button', { name: /^Menú de la cuenta/ }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByRole('heading', { name: 'Inicia sesión en Adiutor' })).toBeVisible();

  // On a browser that chose English, the account's Spanish wins once signed in.
  const english = await browser.newContext();
  try {
    const other = await english.newPage();
    await useOwnClientIp(other);
    await other.goto('/auth');
    await signIn(other, { email, password });
    await expect(other.locator('html')).toHaveAttribute('lang', 'es-ES');
  } finally {
    await english.close();
  }
});

test("an account on Default follows Adiutor's default language, also after it changes", async ({
  page,
}) => {
  const email = freshAddress('default-language');
  const companyId = await findCompanyId(COMPANY_SLUG);
  await page.goto(await storeInvitation({ companyId, email, role: 'client' }));
  await createAccountFromInvitation(page, 'Default Tester', 'default-language-password');

  try {
    await page.goto('/account');
    await saveAccountLanguage(page, 'Language', 'Nederlands', 'Save language');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl-NL');

    // Back to Default: the page reloads in Adiutor's default language, without a cookie of its own.
    await saveAccountLanguage(page, 'Taal', /^Standaard/, 'Taal opslaan');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(toasts(page)).toContainText('Language saved.');
    await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveText(
      'Default',
    );
    const cookies = await page.context().cookies();
    expect(cookies.find(({ name }) => name === LOCALE_COOKIE)).toBeUndefined();

    // A staff Admin changes the default language in Settings: the account follows.
    await setDefaultLocale('es-ES');
    await page.goto('/account');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
    await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveText(
      'Predeterminado',
    );
  } finally {
    await setDefaultLocale('en-US');
  }
});

test('a language left in the browser is not saved with an account on Default, and goes at sign-in', async ({
  browser,
  page,
}) => {
  const email = freshAddress('leftover-language');
  const password = 'leftover-language-password';
  const companyId = await findCompanyId(COMPANY_SLUG);
  await page.goto(await storeInvitation({ companyId, email, role: 'client' }));
  await createAccountFromInvitation(page, 'Leftover Tester', password);

  // A shared browser where the last person left Dutch behind: signing out keeps the language.
  const shared = await browser.newContext();
  try {
    await shared.addCookies([{ name: LOCALE_COOKIE, value: 'nl-NL', url: E2E_BASE_URL }]);
    const other = await shared.newPage();
    await useOwnClientIp(other);
    await other.goto('/auth');
    await expect(other.locator('html')).toHaveAttribute('lang', 'nl-NL');
    await other.getByLabel('E-mailadres').fill(email);
    await other.getByLabel('Wachtwoord').fill(password);
    await other.getByRole('button', { name: 'Inloggen', exact: true }).click();
    await expect(other).toHaveURL(/\/(dashboard|companies\/)/);

    // The account still follows Adiutor's default language, and now the browser does too.
    await expect(other.locator('html')).toHaveAttribute('lang', 'en-US');
    const cookies = await shared.cookies();
    expect(cookies.find(({ name }) => name === LOCALE_COOKIE)).toBeUndefined();
    await other.goto('/account');
    await expect(other.getByRole('combobox', { name: 'Language', exact: true })).toHaveText(
      'Default',
    );
  } finally {
    await shared.close();
  }
});

test('the theme and language menu on a page reached signed in saves the language with the account', async ({
  page,
}) => {
  const email = freshAddress('corner-language');
  const companyId = await findCompanyId(COMPANY_SLUG);
  await page.goto(await storeInvitation({ companyId, email, role: 'client' }));
  await createAccountFromInvitation(page, 'Corner Tester', 'corner-language-password');

  // The not-found page has no account menu, so it has the theme and language button.
  await page.goto('/does-not-exist');
  await chooseLanguage(page, 'Theme and language: System, English (US)', 'Nederlands', 'nl-NL');
  await expect(page.getByRole('heading', { level: 1, name: 'Pagina niet gevonden' })).toBeVisible();

  // Saved with the account, not only in the cookie: the Language card agrees with the screens.
  await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl-NL');
  await expect(page.getByRole('combobox', { name: 'Taal', exact: true })).toHaveText('Nederlands');

  // Default in that menu saves none again, and the browser follows Adiutor's default language.
  await page.goto('/does-not-exist');
  await chooseLanguage(page, 'Thema en taal: Systeem, Nederlands', 'Standaard', 'en-US');
  await page.goto('/account');
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveText('Default');
});

test('an invitation sent in Dutch arrives in Dutch', async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  const email = freshAddress('dutch-invitation');
  await page.goto(`/companies/${COMPANY_SLUG}/members`);
  // The invite link form next to it has a role select of its own.
  const inviteForm = page.locator('form').filter({ has: page.getByLabel('Email addresses') });
  await inviteForm.getByLabel('Email addresses').fill(email);
  await inviteForm.getByRole('combobox', { name: 'Role', exact: true }).click();
  await page.getByRole('option', { name: /^Client/ }).click();
  await inviteForm.getByRole('combobox', { name: 'Email language' }).click();
  await page.getByRole('option', { name: 'Nederlands' }).click();
  await inviteForm.getByRole('button', { name: 'Send invitations' }).click();
  await expect(toasts(page)).toContainText(`Invitation sent to ${email}.`);

  const sent = await waitForEmail(email);
  expect(sent.subject).toMatch(new RegExp(`nodigt je uit voor ${COMPANY_NAME} op Adiutor$`));
  expect(sent.html).toContain('lang="nl-NL"');
});
