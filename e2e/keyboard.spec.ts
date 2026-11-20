/**
 * @file Keyboard navigation and pointer cursors: everything works without a
 * mouse, focus goes where people expect, and clickable things look clickable.
 */
import { type Locator, type Page } from '@playwright/test';

import {
  PROVIDER_LINKED_COOKIE,
  PROVIDER_STEP_UP_COOKIE,
  providerLinkedCookieValue,
  providerStepUpCookieValue,
} from '../src/lib/sign-in/oauth-providers';
import { forgetLimitsOf, storeRequest } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_SLUG,
  PAGING_COMPANY_SLUG,
  PLATFORM_ADMIN,
  REQUESTS_CLIENT,
  SEEDED_REQUESTS,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  adminStorageState,
  answerPictures,
  markdownEditor,
  openUser,
  signIn,
  signInAsUser,
  type StorageState,
  storageStateFor,
  toasts,
} from './support/helpers';
import { expect, test } from './support/test';

/** Sign-in cookies of the staff Admin. */
let adminState: StorageState;

/** Sign-in cookies of a Client of the seeded company, for the company's side of a request. */
let clientState: StorageState;

/** The members page of the seeded company with more members than fit on a page. */
let pagingMembersPath: string;

test.beforeAll(async ({ browser }) => {
  // At the address the app links to (its URL name).
  pagingMembersPath = `/companies/${PAGING_COMPANY_SLUG}/members`;
  adminState = await adminStorageState(browser);
  clientState = await storageStateFor(browser, REQUESTS_CLIENT);
});

/**
 * Stores a request of the test's own in the seeded company, raised by its
 * Client.
 *
 * @param title - The request's title.
 * @returns The path of the request's page.
 */
async function storeOwnRequest(title: string): Promise<string> {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });
  return `/requests/${number}`;
}

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

/**
 * The outline drawn around an element. Read it with `expect.poll`: with
 * reduced motion every change of style still runs a transition of a few
 * microseconds, so a value read at once can be the one it starts from (3px,
 * the width an outline has before any is set).
 *
 * @param locator - The element.
 * @returns Its computed `outline-style` and `outline-width`.
 */
function outlineOf(locator: Locator): Promise<{ style: string; width: string }> {
  return locator.evaluate((element) => {
    const { outlineStyle, outlineWidth } = getComputedStyle(element);
    return { style: outlineStyle, width: outlineWidth };
  });
}

/** A phone's screen, where the top bar sticks above the content. */
const PHONE = { width: 375, height: 667 };

/**
 * The bottom edge of the layers that stick to the top of a small screen: the
 * top bar and, while signed in as a user, the banner under it.
 *
 * @param page - The browser page, signed in.
 * @returns How far down from the top of the screen they reach, in pixels.
 */
async function stickyLayersBottom(page: Page): Promise<number> {
  const layers = [
    page.locator('header').filter({ has: page.getByRole('button', { name: 'Open menu' }) }),
    page.getByRole('region', { name: 'Signed in as someone else' }),
  ];
  const bottoms = await Promise.all(
    layers.map(async (layer) => {
      const box = (await layer.count()) > 0 ? await layer.boundingBox() : null;
      return box ? box.y + box.height : 0;
    }),
  );
  return Math.max(...bottoms);
}

/**
 * Checks that a control the keyboard goes back to comes out from under the
 * sticky layers. On the account's Security page, with focus on the Security
 * tab, it scrolls the Profile tab before it to just under the top of the
 * screen (where the layers cover it, but the browser counts it as visible)
 * and presses Shift+Tab.
 *
 * @param page - The browser page, signed in, phone-sized and on `/account/security`.
 */
async function expectShiftTabClearsStickyLayers(page: Page): Promise<void> {
  const tabs = page.getByRole('navigation', { name: 'Account sections' });
  const profile = tabs.getByRole('link', { name: 'Profile' });
  const security = tabs.getByRole('link', { name: 'Security' });
  await security.focus();

  // Retried while the page's cards stream in: it has to be long enough to scroll that far.
  await expect(async () => {
    await profile.evaluate((element) =>
      window.scrollBy(0, element.getBoundingClientRect().top - 8),
    );
    const top = (await profile.boundingBox())?.y ?? -1;
    expect(top, 'the Profile tab is on screen').toBeGreaterThanOrEqual(0);
    expect(top, 'the Profile tab is under the sticky layers').toBeLessThan(
      await stickyLayersBottom(page),
    );
  }).toPass();

  await page.keyboard.press('Shift+Tab');
  await expect(profile).toBeFocused();
  await expect(async () => {
    const top = (await profile.boundingBox())?.y ?? -1;
    expect(top, 'the focused tab is below the sticky layers').toBeGreaterThanOrEqual(
      await stickyLayersBottom(page),
    );
  }).toPass();
}

/**
 * Checks that a card reached by its anchor lands just below the sticky
 * layers: not under them, and without a second offset on top of the page's
 * scroll padding.
 *
 * @param page - The browser page, signed in and phone-sized.
 */
async function expectCardLandsBelowStickyLayers(page: Page): Promise<void> {
  // A page load of its own: with focus still on a control, the page leaves it where it is
  // instead of moving it to the card's heading (and an address that differs only by its
  // anchor wouldn't load the page again).
  await page.goto('about:blank');
  await page.goto('/account/security#passkeys');
  const card = page.locator('section#passkeys');
  await expect(card.locator('[data-card-heading]')).toBeFocused();
  await expect(async () => {
    const top = (await card.boundingBox())?.y ?? -1;
    const layersBottom = await stickyLayersBottom(page);
    expect(top, 'the card is below the sticky layers').toBeGreaterThanOrEqual(layersBottom);
    // The card's own margin adds a little room, not another top bar's worth.
    expect(top, 'the card is close under them').toBeLessThan(layersBottom + 40);
  }).toPass();
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

  (['light', 'dark'] as const).forEach((colorScheme) => {
    test(`the item the keyboard is on is outlined, not only filled, in ${colorScheme} mode`, async ({
      page,
    }) => {
      // The fill alone is about 1.1:1 against the panel; the outline is the cue (WCAG 1.4.11).
      await page.emulateMedia({ colorScheme });
      await page.goto('/dashboard');
      const trigger = page.getByRole('button', { name: /^Account menu/ });
      const settings = page.getByRole('menuitem', { name: 'Account settings' });
      const signOut = page.getByRole('menuitem', { name: 'Sign out' });

      // In a menu: the item that has focus, and only that one.
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(settings).toBeFocused();
      await expect.poll(() => outlineOf(settings)).toEqual({ style: 'solid', width: '2px' });
      await expect.poll(async () => (await outlineOf(signOut)).style).toBe('none');
      await page.keyboard.press('End');
      await expect(signOut).toBeFocused();
      await expect.poll(() => outlineOf(signOut)).toEqual({ style: 'solid', width: '2px' });
      await expect.poll(async () => (await outlineOf(settings)).style).toBe('none');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);

      // In a select's list: the same.
      await page.goto(`/companies/${COMPANY_SLUG}/members`);
      const role = page.getByRole('combobox', { name: `Role of ${CLIENT_WATCHER.name}` });
      await openWithEnter(role);
      const watcher = page.getByRole('option', { name: 'Watcher' });
      const client = page.getByRole('option', { name: 'Client' });
      await expect(watcher).toBeFocused();
      await expect.poll(() => outlineOf(watcher)).toEqual({ style: 'solid', width: '2px' });
      await expect.poll(async () => (await outlineOf(client)).style).toBe('none');
      await page.keyboard.press('ArrowUp');
      await expect(client).toBeFocused();
      await expect.poll(() => outlineOf(client)).toEqual({ style: 'solid', width: '2px' });
      await expect.poll(async () => (await outlineOf(watcher)).style).toBe('none');
      // Escape leaves the role as it was.
      await page.keyboard.press('Escape');
      await expect(role).toBeFocused();
    });
  });

  test('a role is only saved when picked with Enter, not while browsing', async ({ page }) => {
    await page.goto(`/companies/${COMPANY_SLUG}/members`);
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
      .filter({ has: page.getByText('You', { exact: true }) })
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
    await page.goto(`/companies/${COMPANY_SLUG}/members`);

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

  test('a button keeps focus while its form saves, and after', async ({ page }) => {
    await page.goto('/admin/staff');
    const save = page.getByRole('button', { name: 'Save name' });

    // Saving the name unchanged changes nothing, but runs the action.
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(toasts(page)).toContainText('Name saved.');
    // Busy, not disabled, while it saved: a disabled button drops focus to the top of the page.
    await expect(save).toBeFocused();
    await expect(save).toBeEnabled();
  });

  test('toasts are reached with F8 and dismissed with the keyboard', async ({ page }) => {
    await page.goto(`/companies/${COMPANY_SLUG}/members`);
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
    // It starts on the current page's link, at the top, not on the account menu at the bottom.
    await expect(menu.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused();
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

  test("choosing Account settings in the mobile menu's account menu closes the mobile menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    const open = page.getByRole('button', { name: 'Open menu' });
    const menu = page.getByRole('dialog', { name: 'Menu' });

    // With the keyboard: the account menu, then Enter on Account settings.
    await open.click();
    await menu.getByRole('button', { name: /^Account menu/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Account settings' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(menu).toHaveCount(0);
    // Back on the button that opened the mobile menu, like after Escape.
    await expect(open).toBeFocused();

    // With a tap, from another page.
    await page.goto('/dashboard');
    await open.click();
    await menu.getByRole('button', { name: /^Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Account settings' }).click();
    await expect(page).toHaveURL('/account');
    await expect(menu).toHaveCount(0);
  });

  test('clickable things show a pointer, disabled ones a not-allowed cursor', async ({ page }) => {
    await page.goto(`/companies/${COMPANY_SLUG}/members`);

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
    await chooseTab(page, 'Company sections', 'Requests', COMPANY_NAME);
    await expect(page).toHaveURL(`/companies/${COMPANY_SLUG}`);
    await expect(page).toHaveTitle(`Requests · ${COMPANY_NAME} · Adiutor`);

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

test.describe('an error in a dialog', () => {
  test.use({ reducedMotion: 'reduce' });
  // The company's Client: they can deactivate their own account, which asks for the password.
  test.beforeEach(async ({ context }) => {
    // The test enters two of the five wrong passwords a user gets: a retry starts from none.
    await forgetLimitsOf(REQUESTS_CLIENT.email);
    await context.addCookies(clientState.cookies);
  });

  test('takes focus each time it comes, and one Escape closes the dialog', async ({ page }) => {
    const incorrect = 'That password is incorrect.';
    await page.goto('/account/security');
    const trigger = page.getByRole('button', { name: 'Deactivate', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Deactivate your account?' });
    const password = dialog.getByLabel('Current password');
    const error = dialog.getByRole('alert').filter({ hasText: incorrect });

    // A wrong password: the error is shown in the dialog and takes focus.
    await password.fill('not the password');
    await page.keyboard.press('Enter');
    await expect(error).toBeFocused();
    // The first alert is marked, so the next one is known to be another.
    await error.evaluate((element) => element.setAttribute('data-seen', ''));

    // The same wrong password again (it stays typed): the same words, in an alert of their own
    // that takes focus from the field again, so a screen reader announces it a second time.
    await password.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('[role="alert"][data-seen]')).toHaveCount(0);
    await expect(error).toBeFocused();

    // Inline only: a toast would sit above the dialog and take the first Escape. (The
    // notifications are hidden from assistive technology while a dialog is open, hence by text.)
    await expect(page.getByText(incorrect)).toHaveCount(1);

    // One Escape closes the dialog, and focus is back on its button.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe('signed in as a user', () => {
  test.use({ reducedMotion: 'reduce' });

  // A session of its own: signing in as someone changes what the shared Admin session shows.
  test('the banner comes first in the content, and going back lands on the card', async ({
    page,
  }) => {
    await signIn(page, PLATFORM_ADMIN);
    await signInAsUser(page, CLIENT_WATCHER.name);
    // A fresh page, so the first Tab starts from the top (not from where the dialog left focus).
    await page.goto('/dashboard');
    await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    const back = page
      .getByRole('region', { name: 'Signed in as someone else' })
      .getByRole('button', { name: 'Back to my account' });
    await expect(back).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#sign-in-as$/);
    await expect(page.getByRole('heading', { name: 'Sign in as user' })).toBeFocused();
  });
});

test.describe('on a phone, under the sticky layers', () => {
  test.use({ reducedMotion: 'reduce' });
  // The second test signs in as a user, which counts towards the Admin's ten an hour: forgotten
  // afterwards, so the specs after this one have as many left as before.
  test.afterEach(async () => {
    await forgetLimitsOf(PLATFORM_ADMIN.email);
  });

  test('a control reached with Shift+Tab, and a card reached by its anchor, clear the top bar', async ({
    context,
    page,
  }) => {
    await context.addCookies(adminState.cookies);
    await page.setViewportSize(PHONE);
    await page.goto('/account/security');

    await expectShiftTabClearsStickyLayers(page);
    await expectCardLandsBelowStickyLayers(page);
  });

  // A session of its own: signing in as someone changes what the shared Admin session shows.
  test('while signed in as a user, they clear the banner under the top bar too', async ({
    page,
  }) => {
    await signIn(page, PLATFORM_ADMIN);
    await signInAsUser(page, CLIENT_WATCHER.name);
    await page.setViewportSize(PHONE);
    await page.goto('/account/security');
    const banner = page.getByRole('region', { name: 'Signed in as someone else' });
    await expect(banner).toBeVisible();
    // The page knows how tall the banner is, so it can keep what it scrolls to clear of it.
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--signed-in-as-banner-height'),
        ),
      )
      .toMatch(/^\d+px$/);

    await expectShiftTabClearsStickyLayers(page);
    await expectCardLandsBelowStickyLayers(page);
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
    // Down goes through the row, then on to the languages, Default first.
    for (const name of ['Light', 'Dark', 'Default', 'English (US)']) {
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
    for (const name of ['Light', 'Dark', 'Default', 'English (US)', 'Nederlands']) {
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

test.describe('the picture choice', () => {
  test('the arrow keys move between the pictures, and Tab leaves them as one stop', async ({
    page,
  }) => {
    await answerPictures(page);
    await signIn(page, SUPPORT_STAFF);
    await page.goto('/account');
    const google = page.getByRole('radio', { name: `Google · ${SUPPORT_STAFF.email}` });
    const initials = page.getByRole('radio', { name: 'Initials' });

    await google.focus();
    await page.keyboard.press('ArrowDown');
    await expect(initials).toBeFocused();
    await expect(initials).toBeChecked();
    await page.keyboard.press('Tab');
    // Nothing is saved: the choice only changes with Save picture.
    await expect(page.getByRole('button', { name: 'Save picture' })).toBeFocused();
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
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
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
});

test.describe('requests', () => {
  test.use({ reducedMotion: 'reduce' });

  test.describe('as the staff', () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies(adminState.cookies);
    });

    test('a filter menu filters with the keyboard and keeps focus on its button', async ({
      page,
    }) => {
      await page.goto('/requests');
      const trigger = page.getByRole('button', { name: 'Type', exact: true });
      expect(await cursorOf(trigger)).toBe('pointer');

      // Escape closes it and changes nothing.
      await trigger.focus();
      await expect(async () => {
        await trigger.press('Enter');
        await expect(page.getByRole('menu')).toBeVisible({ timeout: 1000 });
      }).toPass();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(page).toHaveURL('/requests');

      // The arrow keys move through the choices, and Enter picks one.
      await trigger.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      const hotfix = page.getByRole('menuitemradio', { name: 'Hotfix' });
      await expect(async () => {
        await page.keyboard.press('ArrowDown');
        await expect(hotfix).toBeFocused({ timeout: 250 });
      }).toPass();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/requests?type=hotfix');
      // The button now says what's chosen, and still has focus.
      await expect(page.getByRole('button', { name: 'Type: Hotfix' })).toBeFocused();
    });

    test('code and a table in a request’s text are reached and scrolled with the keyboard', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-write']);
      await page.goto(`/requests/${SEEDED_REQUESTS.formatted.number}`);

      // A table sits in a box that scrolls on a narrow screen, so the box takes focus.
      const table = page.getByRole('group', { name: 'Table' });
      await table.focus();
      await expect(table).toBeFocused();

      // A block of code wider than the page: the arrow keys scroll it once it has focus.
      const code = page.getByRole('group', { name: 'Bash code' });
      expect(await code.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
      );
      await code.focus();
      await expect(code).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => code.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

      // Tab reaches the next block from the block before it: first the button that copies its
      // code, then the code, and the ring shows which one has focus.
      const config = page.getByRole('group', { name: 'Nginx config code' });
      const copy = page
        .getByRole('figure')
        .filter({ has: code })
        .getByRole('button', { name: 'Copy code' });
      await config.focus();
      await page.keyboard.press('Tab');
      await expect(copy).toBeFocused();
      await expect.poll(() => outlineOf(copy)).toEqual({ style: 'solid', width: '2px' });
      // The ring lies inside the block's box, which cuts off what's outside it.
      expect(
        await copy.evaluate((button) => {
          const box = button.closest('figure')?.getBoundingClientRect();
          const own = button.getBoundingClientRect();
          // The ring is 2px wide, 2px away from the button.
          return box !== undefined && own.top - 4 >= box.top && own.right + 4 <= box.right;
        }),
      ).toBe(true);
      // Enter copies, and the button that says so keeps the focus.
      await page.keyboard.press('Enter');
      const copiedButton = page.getByRole('button', { name: 'Copied' });
      await expect(copiedButton).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(code).toBeFocused();
      await expect.poll(() => outlineOf(code)).toEqual({ style: 'solid', width: '2px' });
    });

    test('a status is only saved when picked with Enter, not while browsing', async ({ page }) => {
      await page.goto(await storeOwnRequest('A status picked with the keyboard'));
      const status = page.getByRole('combobox', { name: 'Status' });
      await expect(status).toHaveText('Open');

      // Browse the statuses and close: nothing changes.
      await openWithEnter(status);
      await expect(page.getByRole('option', { name: 'Open' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('option', { name: 'To do' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(status).toBeFocused();
      await page.reload();
      await expect(status).toHaveText('Open');

      // Pick To do with Enter: saved, and focus stays on the select.
      await openWithEnter(status);
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('option', { name: 'To do' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Status saved.');
      await expect(status).toBeFocused();
      await page.reload();
      await expect(status).toHaveText('To do');
    });

    test('the editor opens large and comes back with the keyboard, the cursor in its place', async ({
      page,
    }) => {
      await page.goto(await storeOwnRequest('A reply written large with the keyboard'));
      const reply = await markdownEditor(page, 'Your reply');
      await reply.focus();
      await page.keyboard.type('one four');
      // The cursor goes back to before "four", and the text goes on there. (Typing there also
      // has the editor take the cursor's new place: it follows the cursor while it has the
      // focus, and a test's keys come faster than it hears of them.)
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type('two ');
      await expect(reply).toHaveText('one two four');

      // The toolbar is one stop before the text, and the button is its last: End reaches it.
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('End');
      await expect(page.getByRole('button', { name: 'Large view' })).toBeFocused();
      await page.keyboard.press('Enter');

      // The text has the focus in the dialog, and typing goes on where the cursor was.
      const dialog = page.getByRole('dialog', { name: 'Your reply' });
      const large = dialog.getByRole('textbox', { name: 'Your reply' });
      await expect(large).toBeFocused();
      await page.keyboard.type('three ');
      await expect(large).toHaveText('one two three four');

      // Tab leaves the text and stays in the dialog: its close button, its toolbar, the text.
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Bold' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(large).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Bold' })).toBeFocused();
      await page.keyboard.press('Tab');

      // Escape closes it: the text has the focus on the page, the cursor still in its place.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(reply).toBeFocused();
      await page.keyboard.type('and ');
      await expect(reply).toHaveText('one two three and four');

      // And the button brings it back as well as Escape does.
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await expect(large).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('End');
      await expect(dialog.getByRole('button', { name: 'Large view' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(reply).toBeFocused();
    });

    test('a reply is sent with the keyboard, and focus is never lost', async ({ page }) => {
      await page.goto(await storeOwnRequest('A reply sent with the keyboard'));
      const reply = await markdownEditor(page, 'Your reply');
      const send = page.getByRole('button', { name: 'Send reply' });
      const sendAndWait = page.getByRole('button', { name: 'Send and wait for the company' });

      // The toolbar is one stop before the editor: the arrow keys move between its buttons,
      // Enter presses one, and focus goes back to the text. (This comes before anything is sent:
      // the toast about a sent reply is a layer too, and would take the first Escape.)
      const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
      await reply.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(toolbar.getByRole('button', { name: 'Italic' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(reply).toBeFocused();
      await page.keyboard.type('slanted');
      await expect(reply.locator('em')).toHaveText('slanted');
      // The link dialog closes with Escape, and focus returns to its button.
      // (Coming back, focus is on the button it was on; each arrow key moves it one on.)
      await page.keyboard.press('Shift+Tab');
      await expect(toolbar.getByRole('button', { name: 'Italic' })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(toolbar.getByRole('button', { name: 'Strikethrough' })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(toolbar.getByRole('button', { name: 'Code', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      const linkButton = toolbar.getByRole('button', { name: 'Link' });
      await expect(linkButton).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Link' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Link' })).toHaveCount(0);
      await expect(linkButton).toBeFocused();
      // Tab goes on to the text, which is cleared for the next step.
      await page.keyboard.press('Tab');
      await expect(reply).toBeFocused();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Delete');
      await expect(reply).toHaveText('');

      // The field, then its buttons. Sending keeps focus on the button, which stays.
      await reply.focus();
      await page.keyboard.type('We are looking into it.');
      await page.keyboard.press('Tab');
      await expect(send).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Reply sent.');
      await expect(reply).toHaveText('');
      await expect(send).toBeFocused();

      // In a list Tab leaves the editor too, instead of nesting the item: nobody gets stuck.
      await reply.focus();
      await page.keyboard.type('- one');
      await page.keyboard.press('Enter');
      await page.keyboard.type('two');
      await expect(reply.getByRole('listitem')).toHaveCount(2);
      await page.keyboard.press('Tab');
      await expect(send).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(reply).toBeFocused();
      // The item nests with its own shortcut, and the text is cleared for the next step.
      await page.keyboard.press('ControlOrMeta+]');
      await expect(reply.locator('ul ul > li')).toHaveText('two');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Delete');
      await expect(reply).toHaveText('');

      // "Send and wait for the company" goes once the request waits: focus moves to the
      // conversation's heading, not to nowhere.
      await reply.focus();
      await page.keyboard.type('Which printer is it?');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(sendAndWait).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Reply sent.');
      await expect(sendAndWait).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: 'Conversation' })).toBeFocused();
    });
  });

  test.describe('as someone at the company', () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies(clientState.cookies);
    });

    test('cancelling a request asks first, keeps focus inside and returns it', async ({ page }) => {
      await page.goto(await storeOwnRequest('A request cancelled with the keyboard'));
      const cancelRequest = page
        .getByRole('region', { name: 'Details' })
        .getByRole('button', { name: 'Cancel request' });

      await cancelRequest.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog', { name: 'Cancel this request?' });
      await expect(dialog).toBeVisible();
      // It starts on the way out, which doesn't say "Cancel", and focus stays inside.
      const keep = dialog.getByRole('button', { name: 'Keep request' });
      const confirm = dialog.getByRole('button', { name: 'Cancel request' });
      await expect(keep).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(confirm).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(keep).toBeFocused();

      // Escape and "Keep request" both close it, with focus back on the button.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(cancelRequest).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(keep).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(cancelRequest).toBeFocused();

      // Confirming removes the button: focus moves to its card's heading.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      await expect(confirm).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Request cancelled.');
      await expect(cancelRequest).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeFocused();
    });
  });
});
