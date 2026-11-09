/**
 * @file Keyboard navigation and pointer cursors: everything works without a
 * mouse, focus goes where people expect, and clickable things look clickable.
 */
import { type Locator, type Page } from '@playwright/test';

import { findCompanyId } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_SLUG,
  PAGING_COMPANY_SLUG,
} from './support/fixtures';
import { adminStorageState, openUser, type StorageState, toasts } from './support/helpers';
import { expect, test } from './support/test';
import {
  PROVIDER_LINKED_COOKIE,
  PROVIDER_STEP_UP_COOKIE,
  providerLinkedCookieValue,
  providerStepUpCookieValue,
} from '../src/lib/sign-in/oauth-providers';
import getTestDatabaseUrl from '../tests/database/database-url';

/** Sign-in cookies of the staff Admin. */
let adminState: StorageState;

/** ID of the seeded company. */
let companyId: string;

/** The members page of the seeded company with more members than fit on a page. */
let pagingMembersPath: string;

test.beforeAll(async ({ browser }) => {
  companyId = await findCompanyId(getTestDatabaseUrl(), COMPANY_SLUG);
  // At the address the app links to (its URL name).
  pagingMembersPath = `/companies/${PAGING_COMPANY_SLUG}/members`;
  adminState = await adminStorageState(browser);
});

/**
 * Opens a select with Enter and waits until an option has focus, so the
 * next key presses go to the list. Retries, because right after a (re)load
 * the page may still be hydrating and ignore the first key press.
 *
 * @param select - The select's combobox.
 */
async function openWithEnter(select: Locator): Promise<void> {
  const page = select.page();
  await expect(async () => {
    await select.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.locator('[role="option"]:focus')).toHaveCount(1);
}

/**
 * Chooses a section tab with Enter and checks it keeps focus, now marked as
 * the current one, with the page's heading still there.
 *
 * @param page - The browser page.
 * @param section - The tabs' landmark name, e.g. "Company sections".
 * @param tab - The tab to choose.
 * @param heading - The page's heading, above the tabs.
 */
async function chooseTab(page: Page, section: string, tab: string, heading: string): Promise<void> {
  const link = page.getByRole('navigation', { name: section }).getByRole('link', { name: tab });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(link).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

/**
 * The mouse cursor shown over an element.
 *
 * @param locator - The element.
 * @returns Its computed `cursor` value.
 */
function cursorOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).cursor);
}

test.describe('signed in', () => {
  test.use({ reducedMotion: 'reduce' });
  test.beforeEach(async ({ context }) => {
    await context.addCookies(adminState.cookies);
  });

  test('the first Tab shows the skip link, which moves focus to the content', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('the account menu works with arrow keys and Escape, theme row included', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/dashboard');
    const trigger = page.getByRole('button', { name: /^Account menu/ });

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Account settings' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused();

    // Left and right move within the theme row; Enter chooses and keeps the menu open.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const dark = page.getByRole('menuitemradio', { name: 'Dark' });
    await expect(dark).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(dark).toBeChecked();
    await expect(dark).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/account');
  });

  test('a role is only saved when picked with Enter, not while browsing', async ({ page }) => {
    await page.goto(`/companies/${companyId}/members`);
    const role = page.getByRole('combobox', { name: `Role of ${CLIENT_WATCHER.name}` });

    // Browse the roles and close: nothing changes.
    await openWithEnter(role);
    await expect(page.getByRole('option', { name: 'Watcher' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('option', { name: 'Client' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('option', { name: 'Admin' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(role).toBeFocused();
    await page.reload();
    await expect(role).toHaveText('Watcher');

    // Pick Client with Enter: saved, and focus stays on the select. Then put it back.
    await openWithEnter(role);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('option', { name: 'Client' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toasts(page)).toContainText('Role updated.');
    await expect(role).toBeFocused();
    await page.reload();
    await expect(role).toHaveText('Client');

    await openWithEnter(role);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Watcher' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toasts(page)).toContainText('Role updated.');
    await expect(role).toBeFocused();
    await page.reload();
    await expect(role).toHaveText('Watcher');
  });

  test('your own role asks first, and Escape puts it back with focus on the select', async ({
    page,
  }) => {
    await page.goto('/admin/staff');
    const role = page
      .getByRole('row')
      .filter({ hasText: '(you)' })
      .getByRole('combobox', { name: /^Role of / });

    await openWithEnter(role);
    await page.keyboard.press('ArrowDown');
    // Radix moves focus on a timer: Enter before that would pick the current role.
    await expect(page.getByRole('option', { name: /^Manager/ })).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Step down to Manager?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(role).toBeFocused();
    await expect(role).toHaveText('Admin');
    await page.reload();
    await expect(role).toHaveText('Admin');
  });

  test('the confirm dialog traps focus, cancels with Escape and confirms', async ({ page }) => {
    await page.goto(`/companies/${companyId}/members`);

    // Make a link to revoke, so the test changes nothing else.
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByRole('textbox', { name: 'Invite link' })).toBeVisible();
    const revokeButtons = page.getByRole('button', { name: /^Revoke .* link created/ });
    const linkCount = await revokeButtons.count();
    const revoke = revokeButtons.first();

    await revoke.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Revoke this invite link?' });
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const confirm = dialog.getByRole('button', { name: 'Revoke' });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(revoke).toBeFocused();

    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(revokeButtons).toHaveCount(linkCount - 1);
    // The row (and its button) went: the toast says so, and focus moves to the card's heading.
    await expect(toasts(page)).toContainText('Invite link revoked.');
    await expect(page.getByRole('heading', { name: 'Invite links' })).toBeFocused();
  });

  test('toasts are reached with F8 and dismissed with the keyboard', async ({ page }) => {
    await page.goto(`/companies/${companyId}/members`);
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByRole('textbox', { name: 'Invite link' })).toBeVisible();
    const revoke = page.getByRole('button', { name: /^Revoke .* link created/ }).first();
    await revoke.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(toasts(page)).toContainText('Invite link revoked.');

    // F8 jumps to the notifications; Tab then goes through the toast to its dismiss button.
    await page.keyboard.press('F8');
    await expect(toasts(page).getByRole('list')).toBeFocused();
    const dismiss = toasts(page).getByRole('button', { name: 'Dismiss notification' });
    await expect(async () => {
      await page.keyboard.press('Tab');
      await expect(dismiss).toBeFocused({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await page.keyboard.press('Enter');
    await expect(toasts(page)).not.toContainText('Invite link revoked.');
  });

  test('the provider-linked notice is dismissed with the keyboard', async ({ context, page }) => {
    await page.goto('/dashboard');
    await context.addCookies([
      {
        name: PROVIDER_LINKED_COOKIE,
        value: encodeURIComponent(providerLinkedCookieValue('github', 'adiutor-tests')),
        url: page.url(),
      },
    ]);
    await page.reload();
    const notice = page.getByRole('region', { name: 'GitHub connected' });
    await expect(notice).toBeVisible();

    // The dismiss button comes right after the notice's link.
    await notice.getByRole('link', { name: 'Disconnect it on the Security page' }).focus();
    await page.keyboard.press('Tab');
    await expect(notice.getByRole('button', { name: 'Dismiss the GitHub notice' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(notice).toHaveCount(0);
    // Its button went with it: focus moves to the main content instead of the top of the page.
    await expect(page.locator('main#main')).toBeFocused();

    // Dismissing removed the cookie, so the notice doesn't come back.
    await expect
      .poll(async () =>
        (await context.cookies()).some(({ name }) => name === PROVIDER_LINKED_COOKIE),
      )
      .toBe(false);
  });

  test('the notice after "Confirm with GitHub" didn’t count is dismissed with the keyboard', async ({
    context,
    page,
  }) => {
    await page.goto('/dashboard');
    // GitHub isn't configured in these tests: the browser gets the cookie its callback leaves.
    await context.addCookies([
      {
        name: PROVIDER_STEP_UP_COOKIE,
        value: encodeURIComponent(providerStepUpCookieValue('github', 'unchecked')),
        url: page.url(),
      },
    ]);
    await page.reload();
    const notice = page.getByRole('region', { name: 'GitHub confirmation' });
    await expect(notice).toBeVisible();
    const dismiss = notice.getByRole('button', { name: 'Dismiss the GitHub confirmation message' });
    // Announced, not focused.
    await expect(dismiss).not.toBeFocused();

    // Skip to the content: the notice comes first, so its dismiss button is the next stop.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dismiss).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(notice).toHaveCount(0);
    // Its button went with it: focus moves to the main content instead of the top of the page.
    await expect(page.locator('main#main')).toBeFocused();

    // Dismissing removed the cookie, so the notice doesn't come back.
    await expect
      .poll(async () =>
        (await context.cookies()).some(({ name }) => name === PROVIDER_STEP_UP_COOKIE),
      )
      .toBe(false);
  });

  test('the mobile menu opens, keeps focus inside and closes', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    const open = page.getByRole('button', { name: 'Open menu' });

    await open.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    // Focus stays in the panel however far you tab.
    for (let step = 0; step < 8; step += 1) {
      // eslint-disable-next-line no-await-in-loop -- Key presses must happen in order.
      await page.keyboard.press('Tab');
      // eslint-disable-next-line no-await-in-loop -- Checked after each press.
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(open).toBeFocused();

    // Following a link closes it.
    await open.click();
    await menu.getByRole('link', { name: 'Companies' }).click();
    await expect(page).toHaveURL('/admin/companies');
    await expect(menu).toHaveCount(0);
  });

  test("the mobile menu's account menu chooses the theme and closes on its own", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    const trigger = menu.getByRole('button', { name: /^Account menu/ });

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Account settings' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Escape closes the account menu first, then the mobile menu.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(menu).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });

  test('clickable things show a pointer, disabled ones a not-allowed cursor', async ({ page }) => {
    await page.goto(`/companies/${companyId}/members`);

    expect(await cursorOf(page.getByRole('button', { name: 'Send invitations' }))).toBe('pointer');
    expect(await cursorOf(page.getByRole('link', { name: 'Members' }))).toBe('pointer');
    expect(
      await cursorOf(page.getByRole('combobox', { name: `Role of ${CLIENT_WATCHER.name}` })),
    ).toBe('pointer');
    expect(await cursorOf(page.getByRole('textbox', { name: 'Email addresses' }))).toBe('text');

    await page.getByRole('button', { name: /^Account menu/ }).click();
    expect(await cursorOf(page.getByRole('menuitem', { name: 'Sign out' }))).toBe('pointer');
    expect(await cursorOf(page.getByRole('menuitemradio', { name: 'Dark' }))).toBe('pointer');
    await page.keyboard.press('Escape');

    const send = page.getByRole('button', { name: 'Send invitations' });
    await send.evaluate((element) => element.setAttribute('disabled', ''));
    expect(await cursorOf(send)).toBe('not-allowed');
  });

  test('an action dialog keeps focus inside and returns it on Escape', async ({ page }) => {
    await openUser(page, CLIENT_WATCHER.name);
    const trigger = page.getByRole('button', { name: 'Delete', exact: true });

    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: new RegExp(`^Delete ${CLIENT_WATCHER.name}`) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    for (let step = 0; step < 6; step += 1) {
      // eslint-disable-next-line no-await-in-loop -- Each Tab depends on the previous one.
      await page.keyboard.press('Tab');
      // eslint-disable-next-line no-await-in-loop -- Checked after each press.
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('the add-passkey dialog keeps focus inside and returns it on Escape', async ({ page }) => {
    await page.goto('/account/security');
    const add = page.getByRole('button', { name: 'Add passkey' });

    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add a passkey' });
    await expect(dialog).toBeVisible();
    for (let step = 0; step < 5; step += 1) {
      // eslint-disable-next-line no-await-in-loop -- Key presses must happen in order.
      await page.keyboard.press('Tab');
      // eslint-disable-next-line no-await-in-loop -- Checked after each press.
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('choosing a section tab keeps focus on it, now the current one', async ({ page }) => {
    await page.goto(`/companies/${COMPANY_SLUG}`);
    // Once the account menu opens, the page has hydrated: Enter on a tab is a client-side move.
    // Closing it returns focus to its button a moment later: wait for that before choosing a tab.
    const accountMenu = page.getByRole('button', { name: /^Account menu/ });
    await accountMenu.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(accountMenu).toBeFocused();

    // A page shown for the first time, then one shown again (kept from before).
    // The title changes with the tab too: it's what the route announcer reads.
    await chooseTab(page, 'Company sections', 'Members', COMPANY_NAME);
    await expect(page).toHaveURL(`/companies/${COMPANY_SLUG}/members`);
    await expect(page).toHaveTitle(`Members · ${COMPANY_NAME} · Adiutor`);
    await chooseTab(page, 'Company sections', 'Overview', COMPANY_NAME);
    await expect(page).toHaveURL(`/companies/${COMPANY_SLUG}`);
    await expect(page).toHaveTitle(`${COMPANY_NAME} · Adiutor`);

    // The account's tabs, reached from the account menu without reloading.
    await accountMenu.click();
    await page.getByRole('menuitem', { name: 'Account settings' }).click();
    await expect(page).toHaveURL('/account');
    await expect(accountMenu).toBeFocused();
    await chooseTab(page, 'Account sections', 'Security', 'Account');
    await expect(page).toHaveURL('/account/security');
  });

  test('the date range form goes From, To, Apply, and Enter applies it', async ({ page }) => {
    await page.goto('/admin/logs?group=people');
    const from = page.getByLabel('From', { exact: true });
    const to = page.getByLabel('To', { exact: true });
    await from.fill('2026-01-01');
    await to.fill('2026-01-31');

    /**
     * Presses Tab until focus leaves a field (a date field takes a Tab per part of the date).
     *
     * @param field - The field that has focus.
     */
    const tabOutOf = async (field: Locator) => {
      await expect(async () => {
        await page.keyboard.press('Tab');
        expect(await field.evaluate((element) => element === document.activeElement)).toBe(false);
      }).toPass();
    };
    await from.focus();
    await tabOutOf(from);
    await expect(to).toBeFocused();
    await tabOutOf(to);
    await expect(page.getByRole('button', { name: 'Apply' })).toBeFocused();

    await to.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]from=2026-01-01/);
    await expect(page).toHaveURL(/[?&]to=2026-01-31/);
    // The other filters stay.
    await expect(page).toHaveURL(/[?&]group=people/);
  });
});

test.describe('signed out', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the theme and language button shows a pointer, works with the keyboard and returns focus on Escape', async ({
    page,
  }) => {
    await page.goto('/auth');
    const trigger = page.getByRole('button', {
      name: 'Theme and language: System, English (US)',
    });
    expect(await cursorOf(trigger)).toBe('pointer');

    await trigger.focus();
    await page.keyboard.press('Enter');
    // The theme row comes first; left and right move within it.
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
    // Down goes through the row, then on to the languages.
    for (const name of ['Light', 'Dark', 'English (US)']) {
      // eslint-disable-next-line no-await-in-loop -- Each key moves on from where the last one went.
      await page.keyboard.press('ArrowDown');
      // eslint-disable-next-line no-await-in-loop -- Checked before the next key is pressed.
      await expect(page.getByRole('menuitemradio', { name })).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Enter on another language reloads the page in it.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
    for (const name of ['Light', 'Dark', 'English (US)', 'Nederlands']) {
      // eslint-disable-next-line no-await-in-loop -- Each key moves on from where the last one went.
      await page.keyboard.press('ArrowDown');
      // eslint-disable-next-line no-await-in-loop -- Checked before the next key is pressed.
      await expect(page.getByRole('menuitemradio', { name })).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl-NL');
    await expect(
      page.getByRole('button', { name: 'Thema en taal: Systeem, Nederlands' }),
    ).toBeVisible();
  });
});

test.describe('tables', () => {
  test.use({ reducedMotion: 'reduce' });
  test.beforeEach(async ({ context }) => {
    await context.addCookies(adminState.cookies);
  });

  test('the Sort menu sorts with the keyboard and keeps focus on its button', async ({ page }) => {
    await page.goto(pagingMembersPath);
    const header = page
      .getByRole('table', { name: /^Members of/ })
      .getByRole('columnheader', { name: 'Name' });
    const trigger = page.getByRole('button', { name: /^Sort members/ });
    expect(await cursorOf(trigger)).toBe('pointer');

    await trigger.focus();
    await expect(async () => {
      await trigger.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible({ timeout: 1000 });
    }).toPass();
    const zToA = page.getByRole('menuitemradio', { name: 'Name, Z to A' });
    await expect(async () => {
      await page.keyboard.press('ArrowDown');
      await expect(zToA).toBeFocused({ timeout: 250 });
    }).toPass();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${pagingMembersPath}?dir=desc`);
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(trigger).toHaveAccessibleName('Sort members: Name, Z to A');
    await expect(trigger).toBeFocused();
  });

  test('the pagination keeps focus when the control used goes away', async ({ page }) => {
    await page.goto(pagingMembersPath);
    const pages = page.getByRole('navigation', { name: 'Pages of members' });
    const previous = pages.getByRole('button', { name: 'Previous page' });
    await expect(previous).toBeDisabled();
    expect(await cursorOf(previous)).toBe('not-allowed');

    // Next is a disabled button on the last page, so focus moves to the current page instead.
    await pages.getByRole('link', { name: 'Next page' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${pagingMembersPath}?page=2`);
    await expect(pages.getByRole('link', { name: 'Page 2' })).toBeFocused();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('the sort menu opens with Enter, moves with the arrows and closes with Escape', async ({
      page,
    }) => {
      await page.goto(pagingMembersPath);
      const trigger = page.getByRole('button', { name: 'Sort members' });

      await trigger.focus();
      await expect(async () => {
        await trigger.press('Enter');
        await expect(page.getByRole('menu')).toBeVisible({ timeout: 1000 });
      }).toPass();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      // Opening with the keyboard puts focus on a choice; the arrows move it down the list.
      await expect(page.locator('[role="menuitemradio"]:focus')).toHaveCount(1);
      const joined = page.getByRole('menuitemradio', { name: 'Joined, newest first' });
      await expect(async () => {
        await page.keyboard.press('ArrowDown');
        await expect(joined).toBeFocused({ timeout: 250 });
      }).toPass();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${pagingMembersPath}?sort=joined`);
    });
  });
});
