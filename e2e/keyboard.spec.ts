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
import {
  backdateMfaConfirmation,
  findUserId,
  forgetLimitsOf,
  resetActivityView,
  setMembershipRole,
  storeEntries,
  storeRequest,
  choosePictureOf,
  storeOwnRequest,
} from './support/db';
import {
  ACTIVITY_CLIENT,
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_OWNER,
  COMPANY_SLUG,
  FINANCE_STAFF,
  OWNED_COMPANY_NAME,
  PAGING_COMPANY_SLUG,
  PLATFORM_ADMIN,
  REQUESTS_CLIENT,
  ROLE_KEYS_WATCHER,
  SEEDED_REQUESTS,
  STAFF_NAME,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  answerPictures,
  markdownEditor,
  openUserTab,
  openWithEnter,
  pressUntilFocused,
  searchSelect,
  signIn,
  signInAsUser,
  type StorageState,
  storageStateFor,
  toasts,
  whenHydrated,
  boardLane,
} from './support/helpers';
import { inOrder, repeatInOrder } from './support/sequence';
import { signedInOnce } from './support/stored-sign-in';
import { expect, test } from './support/test';

/** Gives the staff Admin's sign-in cookies, signed in once for the spec. */
const adminCookies = signedInOnce(PLATFORM_ADMIN);

/** Sign-in cookies of a Client of the seeded company, for the company's side of a request. */
let clientState: StorageState;

/** The members page of the seeded company with more members than fit on a page (at the address the app links to: its URL name). */
const pagingMembersPath = `/companies/${PAGING_COMPANY_SLUG}/members`;

test.beforeAll(async ({ browser }) => {
  clientState = await storageStateFor(browser, REQUESTS_CLIENT);
});

/**
 * Stores a request of the test's own in the seeded company, raised by its
 * Client.
 *
 * @param title - The request's title.
 * @returns The path of the request's page.
 */
async function ownRequestPath(title: string): Promise<string> {
  const number = await storeOwnRequest({ title });
  return `/requests/${number}`;
}

/**
 * Chooses an option of the focused select by typing its name, the way both
 * a short select (which jumps to what's typed) and a long one (which
 * searches it) take it: Enter opens it, the name is typed once its list is
 * there, and Enter picks the option once the keyboard is on it.
 *
 * @param page - The browser page, with the select focused.
 * @param name - The start of the option's name.
 */
async function chooseByTyping(page: Page, name: string): Promise<void> {
  const option = page.getByRole('option', { name: new RegExp(`^${name}`) });
  await page.keyboard.press('Enter');
  await expect(option).toBeVisible();
  await page.keyboard.type(name);
  await expect(option).toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Enter');
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
 * The ids more than one element in the page has. Next keeps the pages it
 * showed last alive (hidden), so two tabs' pages are in the document at once,
 * and an id they share would point a label or a card's name at the wrong one.
 *
 * @param page - The browser page.
 * @returns The ids that aren't unique.
 */
function duplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const counts = new Map<string, number>();
    document.querySelectorAll('[id]').forEach((element) => {
      counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    });
    return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  });
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
 * tab, it scrolls the Preferences tab before it to just under the top of the
 * screen (where the layers cover it, but the browser counts it as visible)
 * and presses Shift+Tab.
 *
 * @param page - The browser page, signed in, phone-sized and on `/account/security`.
 */
async function expectShiftTabClearsStickyLayers(page: Page): Promise<void> {
  const tabs = page.getByRole('navigation', { name: 'Account sections' });
  const previous = tabs.getByRole('link', { name: 'Preferences' });
  const security = tabs.getByRole('link', { name: 'Security' });
  await security.focus();

  // Retried while the page's cards stream in: it has to be long enough to scroll that far.
  await expect(async () => {
    await previous.evaluate((element) =>
      window.scrollBy(0, element.getBoundingClientRect().top - 8),
    );
    const top = (await previous.boundingBox())?.y ?? -1;
    expect(top, 'the Preferences tab is on screen').toBeGreaterThanOrEqual(0);
    expect(top, 'the Preferences tab is under the sticky layers').toBeLessThan(
      await stickyLayersBottom(page),
    );
  }).toPass();

  await page.keyboard.press('Shift+Tab');
  await expect(previous).toBeFocused();
  await expect(async () => {
    const top = (await previous.boundingBox())?.y ?? -1;
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
    await context.addCookies(adminCookies());
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
    const name = `Account menu: ${PLATFORM_ADMIN.name} ${PLATFORM_ADMIN.email}`;
    await expect(trigger).toHaveAccessibleName(name);

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Account settings' })).toBeFocused();
    // Named by its button once, without the avatar's initials.
    await expect(page.getByRole('menu')).toHaveAccessibleName(name);
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
    // A Watcher only this test changes, put back whatever happens, so a failed or retried run
    // leaves nothing behind for the next one or for other tests.
    try {
      await page.goto(`/companies/${COMPANY_SLUG}/members`);
      const role = page.getByRole('combobox', { name: `Role of ${ROLE_KEYS_WATCHER.name}` });
      const watcher = page.getByRole('option', { name: 'Watcher' });
      const client = page.getByRole('option', { name: 'Client' });

      // Browse the roles and close: nothing changes. Radix moves focus to the current role on a
      // timer, so every time the list opens, the first arrow key waits until it's there.
      await openWithEnter(role);
      await expect(watcher).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(client).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(page.getByRole('option', { name: 'Admin' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(role).toBeFocused();
      await page.reload();
      await expect(role).toHaveText('Watcher');

      // Pick Client with Enter: saved, and focus stays on the select. Then put it back.
      await openWithEnter(role);
      await expect(watcher).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(client).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Role updated.');
      await expect(role).toBeFocused();
      await page.reload();
      await expect(role).toHaveText('Client');

      await openWithEnter(role);
      await expect(client).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(watcher).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Role updated.');
      await expect(role).toBeFocused();
      await page.reload();
      await expect(role).toHaveText('Watcher');
    } finally {
      await setMembershipRole(COMPANY_SLUG, ROLE_KEYS_WATCHER.email, 'watcher');
      // Its role changes count towards the Admin's 30 an hour: forgotten, so a repeated or
      // retried run, and the specs after this one, have as many left as before.
      await forgetLimitsOf(PLATFORM_ADMIN.email);
    }
  });

  test('your own role asks first, and Escape puts it back with focus on the select', async ({
    page,
  }) => {
    await page.goto('/admin/settings/staff');
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

  test('a long select is searched by typing, and only Enter picks', async ({ page }) => {
    // Nothing is saved: the zone is picked, never submitted.
    await page.goto('/account/preferences');
    const field = page
      .getByRole('region', { name: 'Time zone' })
      .getByRole('combobox', { name: 'Time zone' });
    const before = (await field.textContent()) ?? '';

    // A letter typed on the field opens it with the letter in the search, which has the focus
    // and its ring; the list filters as the rest is typed, and a screen reader hears the count.
    let panel = await searchSelect(field, 'tokyo');
    const search = panel.getByRole('combobox', { name: 'Time zone' });
    await expect.poll(() => outlineOf(search)).toEqual({ style: 'solid', width: '2px' });
    await expect(panel.getByRole('option')).toHaveText([/^Tokyo/]);
    await expect(panel.getByRole('status')).toHaveText('1 option matches');

    // A region's name lists its zones. The arrow keys, Home and End move the outlined option
    // (the search field keeps the focus and points at it); Escape closes it, nothing changed.
    await search.fill('americas');
    const options = panel.getByRole('option');
    const first = options.first();
    const second = options.nth(1);
    const last = options.last();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expect(search).toHaveAttribute(
      'aria-activedescendant',
      (await second.getAttribute('id')) ?? '',
    );
    await expect.poll(() => outlineOf(second)).toEqual({ style: 'solid', width: '2px' });
    await expect.poll(async () => (await outlineOf(first)).style).toBe('none');
    await page.keyboard.press('End');
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(last).toBeInViewport();
    await page.keyboard.press('Home');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toBeInViewport();
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(field).toBeFocused();
    await expect(field).toHaveText(before);

    // Tab closes it too, without a change, with focus back on the field.
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await page.keyboard.type('lisbon');
    await page.keyboard.press('Tab');
    await expect(panel).toHaveCount(0);
    await expect(field).toBeFocused();
    await expect(field).toHaveText(before);

    // Enter picks the match, and focus is back on the field.
    panel = await searchSelect(field, 'new y');
    await expect(panel.getByRole('option')).toHaveText([/^New York/]);
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(field).toBeFocused();
    await expect(field).toHaveText(/^New York/);
  });

  test('who a new request is for follows its company, chosen with the keyboard alone', async ({
    page,
  }) => {
    // Nothing is raised: the form is filled in, never submitted.
    await page.goto(`/requests/new?company=${COMPANY_SLUG}`);
    await whenHydrated(page);
    const company = page.getByRole('combobox', { name: 'Company' });
    const raiseFor = page.getByRole('combobox', { name: 'Raise it for' });

    // The company's people come with it; it has more than a short select lists, so it's searched.
    const people = await searchSelect(raiseFor, 'E2E Req');
    await expect(people.getByRole('option')).toHaveText([REQUESTS_CLIENT.name]);
    await page.keyboard.press('Enter');
    await expect(raiseFor).toBeFocused();
    await expect(raiseFor).toHaveText(REQUESTS_CLIENT.name);

    // Another company puts it back to the staff member, with focus on the company, and then
    // offers that company's people.
    await page.keyboard.press('Shift+Tab');
    await expect(company).toBeFocused();
    await chooseByTyping(page, OWNED_COMPANY_NAME);
    await expect(company).toBeFocused();
    await expect(company).toHaveText(new RegExp(`^${OWNED_COMPANY_NAME}`));
    await expect(raiseFor).toHaveText('Yourself');
    await expect(raiseFor).not.toHaveAttribute('aria-busy');
    await page.keyboard.press('Tab');
    await expect(raiseFor).toBeFocused();
    await chooseByTyping(page, COMPANY_OWNER.name);
    await expect(raiseFor).toBeFocused();
    await expect(raiseFor).toHaveText(COMPANY_OWNER.name);
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
    await page.goto('/admin/settings');
    const save = page.getByRole('button', { name: 'Save name' });

    // Saving the name unchanged changes nothing, but runs the action.
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(toasts(page)).toContainText('Name saved.');
    // Busy, not disabled, while it saved: a disabled button drops focus to the top of the page.
    await expect(save).toBeFocused();
    await expect(save).toBeEnabled();
  });

  test('a colour field’s swatch and text are reached in turn, the swatch with a visible ring', async ({
    page,
  }) => {
    // Only browsed with Tab: nothing is saved.
    await page.goto('/admin/settings/appearance');
    const text = page.getByRole('textbox', { name: 'Accent', exact: true });
    const swatch = page.getByLabel('Pick the accent', { exact: true });
    // The swatch is an invisible colour input; the square after it shows its focus ring.
    const square = swatch.locator('xpath=following-sibling::span');
    await text.click();

    await page.keyboard.press('Shift+Tab');
    await expect(swatch).toBeFocused();
    await expect(square).toHaveCSS('outline-style', 'solid');

    await page.keyboard.press('Tab');
    await expect(text).toBeFocused();
    await expect(square).toHaveCSS('outline-style', 'none');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Pick the accent for dark mode', { exact: true })).toBeFocused();
  });

  test('the logo’s file field is reached with Tab, with a visible ring', async ({ page }) => {
    // Only browsed with Tab: nothing is uploaded.
    await page.goto('/admin/settings/appearance');
    const field = page.getByLabel('Logo image', { exact: true });
    // Clicking the help text under the field (not the label, which opens the file chooser) starts
    // the keyboard from there.
    await page.getByText(/^A PNG or JPEG of at most 1 MB, at least 32 pixels high/).click();

    await page.keyboard.press('Shift+Tab');
    await expect(field).toBeFocused();
    await expect(field).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Upload logo' })).toBeFocused();
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
    await pressUntilFocused(page, 'Tab', dismiss);
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
    await repeatInOrder(8, async () => {
      await page.keyboard.press('Tab');
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    });
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
    await openUserTab(page, CLIENT_WATCHER.name, 'Manage');
    const trigger = page.getByRole('button', { name: 'Delete', exact: true });

    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: new RegExp(`^Delete ${CLIENT_WATCHER.name}`) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await repeatInOrder(6, async () => {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('the add-webhook dialog keeps focus inside, its choices move with the arrow keys, and Escape returns it', async ({
    page,
  }) => {
    // Opening it needs a recent second step.
    await backdateMfaConfirmation(PLATFORM_ADMIN.email, 0);
    await page.goto('/admin/settings/webhooks');
    const add = page.getByRole('button', { name: 'Add webhook' });

    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add a webhook' });
    await expect(dialog).toBeVisible();
    // The format is one stop: the arrow keys move between its choices.
    const json = dialog.getByRole('radio', { name: 'Signed JSON' });
    await json.focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', { name: 'Chat message' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Chat message' })).toBeFocused();
    // Picking "Chosen types" with the keyboard shows the types to choose, next in the tab order.
    await dialog.getByRole('radio', { name: 'All request types' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', { name: 'Chosen types' })).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('checkbox').first()).toBeFocused();
    await repeatInOrder(12, async () => {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('the add-passkey dialog keeps focus inside and returns it on Escape', async ({ page }) => {
    await page.goto('/account/security');
    const add = page.getByRole('button', { name: 'Add passkey' });

    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add a passkey' });
    await expect(dialog).toBeVisible();
    await repeatInOrder(5, async () => {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('choosing a section tab keeps focus on it, now the current one', async ({ page }) => {
    await page.goto(`/companies/${COMPANY_SLUG}`);
    // Enter on a tab is a client-side move, which needs the page hydrated.
    await whenHydrated(page);
    const accountMenu = page.getByRole('button', { name: /^Account menu/ });

    // A page shown for the first time, then one shown again (kept from before).
    // The title changes with the tab too: it's what the route announcer reads.
    await chooseTab(page, 'Company sections', 'Members', COMPANY_NAME);
    await expect(page).toHaveURL(`/companies/${COMPANY_SLUG}/members`);
    await expect(page).toHaveTitle(`Members · ${COMPANY_NAME} · ${STAFF_NAME}`);
    await chooseTab(page, 'Company sections', 'Requests', COMPANY_NAME);
    await expect(page).toHaveURL(`/companies/${COMPANY_SLUG}`);
    await expect(page).toHaveTitle(`Requests · ${COMPANY_NAME} · ${STAFF_NAME}`);
    // Both pages are in the document now (Next keeps the one before alive), sharing no id.
    expect(await duplicateIds(page)).toEqual([]);

    // The account's tabs, reached from the account menu without reloading.
    await accountMenu.click();
    await page.getByRole('menuitem', { name: 'Account settings' }).click();
    await expect(page).toHaveURL('/account');
    await expect(accountMenu).toBeFocused();
    await chooseTab(page, 'Account sections', 'Security', 'Account');
    await expect(page).toHaveURL('/account/security');
    await chooseTab(page, 'Account sections', 'Preferences', 'Account');
    await expect(page).toHaveURL('/account/preferences');
    await expect(page).toHaveTitle(`Preferences · Account · ${STAFF_NAME}`);
    await chooseTab(page, 'Account sections', 'Activity', 'Account');
    await expect(page).toHaveURL('/account/activity');
    await expect(page).toHaveTitle(`Activity · Account · ${STAFF_NAME}`);

    // The Settings tabs, reached from the menu: each one's title is its own.
    const settingsLink = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' });
    await settingsLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/admin/settings');
    await chooseTab(page, 'Settings sections', 'Staff', 'Settings');
    await expect(page).toHaveURL('/admin/settings/staff');
    await expect(page).toHaveTitle(`Staff · Settings · ${STAFF_NAME}`);
    await chooseTab(page, 'Settings sections', 'Requests', 'Settings');
    await expect(page).toHaveURL('/admin/settings/requests');
    await expect(page).toHaveTitle(`Requests · Settings · ${STAFF_NAME}`);
    await chooseTab(page, 'Settings sections', 'General', 'Settings');
    await expect(page).toHaveURL('/admin/settings');
    await expect(page).toHaveTitle(`Settings · ${STAFF_NAME}`);
  });

  test('choosing a tab of a user’s page keeps focus on it, now the current one', async ({
    page,
  }) => {
    const userId = await findUserId(CLIENT_WATCHER.email);
    const base = `/admin/users/${userId}`;
    await page.goto(base);
    // Enter on a tab is a client-side move, which needs the page hydrated.
    await whenHydrated(page);

    await chooseTab(page, 'User sections', 'Companies', CLIENT_WATCHER.name);
    await expect(page).toHaveURL(`${base}/companies`);
    await expect(page).toHaveTitle(`Companies · User · ${STAFF_NAME}`);
    await chooseTab(page, 'User sections', 'Activity', CLIENT_WATCHER.name);
    await expect(page).toHaveURL(`${base}/activity`);
    await expect(page).toHaveTitle(`Activity · User · ${STAFF_NAME}`);
    await chooseTab(page, 'User sections', 'Manage', CLIENT_WATCHER.name);
    await expect(page).toHaveURL(`${base}/manage`);
    await expect(page).toHaveTitle(`Manage · User · ${STAFF_NAME}`);
    await chooseTab(page, 'User sections', 'Overview', CLIENT_WATCHER.name);
    await expect(page).toHaveURL(base);
    await expect(page).toHaveTitle(`User · ${STAFF_NAME}`);
    // Every tab's page is kept alive now, and none shares an id with another.
    expect(await duplicateIds(page)).toEqual([]);
  });

  test('pages with the same kind of card, kept alive together, give their cards their own anchors', async ({
    page,
  }) => {
    const accountMenu = page.getByRole('button', { name: /^Account menu/ });
    const mainMenu = page.getByRole('navigation', { name: 'Main' });

    // A user's devices, then your own, reached from the account menu without reloading.
    const userId = await findUserId(CLIENT_WATCHER.email);
    await page.goto(`/admin/users/${userId}/activity`);
    // Each page's cards stream in after its header: they must be there before moving on.
    const devicesHeading = page.getByRole('heading', { name: 'Signed-in devices' });
    await expect(devicesHeading).toBeVisible();
    // Once the account menu opens, the page has hydrated: the links below are client-side moves.
    await accountMenu.click();
    await page.getByRole('menuitem', { name: 'Account settings' }).click();
    await expect(page).toHaveURL('/account');
    await chooseTab(page, 'Account sections', 'Activity', 'Account');
    await expect(page).toHaveURL('/account/activity');
    await expect(devicesHeading).toBeVisible();
    // Both devices cards are in the document (Next keeps the user's page alive, hidden).
    await expect(page.locator('#devices')).toHaveCount(1);
    await expect(page.locator('#user-devices')).toHaveCount(1);
    expect(await duplicateIds(page)).toEqual([]);

    // A company's invitations, then the staff's, reached from the menu without reloading.
    await page.goto(`/companies/${COMPANY_SLUG}/members`);
    const linksHeading = page.getByRole('heading', { name: 'Invite links' });
    await expect(linksHeading).toBeVisible();
    await whenHydrated(page);
    await mainMenu.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL('/admin/settings');
    await chooseTab(page, 'Settings sections', 'Staff', 'Settings');
    await expect(page).toHaveURL('/admin/settings/staff');
    await expect(linksHeading).toBeVisible();
    // Both pages' invitation cards are in the document (Next keeps the company's page alive).
    await expect(page.locator('#invite, #invitations, #invite-links')).toHaveCount(3);
    await expect(
      page.locator('#company-invite, #company-invitations, #company-invite-links'),
    ).toHaveCount(3);
    expect(await duplicateIds(page)).toEqual([]);
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
    await expect(page).toHaveURL(/\/manage#sign-in-as$/);
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
    await context.addCookies(adminCookies());
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
    await inOrder(['Light', 'Dark', 'Default', 'English (US)'], async (name) => {
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitemradio', { name })).toBeFocused();
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Enter on another language reloads the page in it.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
    await inOrder(['Light', 'Dark', 'Default', 'English (US)', 'Nederlands'], async (name) => {
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitemradio', { name })).toBeFocused();
    });
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
    // The seed shows initials; this test starts from no choice, and leaves initials behind.
    await choosePictureOf(SUPPORT_STAFF.email, null);
    try {
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
    } finally {
      await choosePictureOf(SUPPORT_STAFF.email, 'initials');
    }
  });
});

test.describe('tables', () => {
  test.use({ reducedMotion: 'reduce' });
  test.beforeEach(async ({ context }) => {
    await context.addCookies(adminCookies());
  });

  test('the Sort menu sorts with the keyboard and keeps focus on its button', async ({ page }) => {
    await page.goto(pagingMembersPath);
    const header = page
      .getByRole('table', { name: /^Members of/ })
      .getByRole('columnheader', { name: 'Name' });
    const trigger = page.getByRole('button', { name: /^Sort members/ });
    expect(await cursorOf(trigger)).toBe('pointer');

    await expect(trigger).toHaveAccessibleName('Sort members: Name, A to Z');
    await trigger.focus();
    await openWithEnter(trigger, 'menu');
    // Named by its button once, not by what it shows and its name both.
    await expect(page.getByRole('menu')).toHaveAccessibleName('Sort members: Name, A to Z');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    const zToA = page.getByRole('menuitemradio', { name: 'Name, Z to A' });
    await pressUntilFocused(page, 'ArrowDown', zToA);
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
      await context.addCookies(adminCookies());
    });

    test('a filter menu filters with the keyboard and keeps focus on its button', async ({
      page,
    }) => {
      await page.goto('/requests');
      const trigger = page.getByRole('button', { name: 'Type', exact: true });
      expect(await cursorOf(trigger)).toBe('pointer');

      // Escape closes it and changes nothing.
      await trigger.focus();
      await openWithEnter(trigger, 'menu');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(page).toHaveURL('/requests');

      // The arrow keys move through the choices, and Enter picks one.
      await trigger.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      const hotfix = page.getByRole('menuitemradio', { name: 'Hotfix' });
      await pressUntilFocused(page, 'ArrowDown', hotfix);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/requests?type=hotfix');
      // The button now says what's chosen, and still has focus.
      await expect(page.getByRole('button', { name: 'Type: Hotfix' })).toBeFocused();
    });

    test('a file is attached and taken off again with the keyboard, focus going back to Attach', async ({
      page,
    }) => {
      const number = await storeOwnRequest({ title: 'A file attached with the keyboard' });
      await page.goto(`/requests/${number}`);
      // The editor loads once the page's scripts run, so the button answers by then.
      await markdownEditor(page, 'Your reply');
      const attach = page.getByRole('button', { name: 'Attach files' });
      expect(await cursorOf(attach)).toBe('pointer');

      // Enter on the button opens the file chooser.
      await attach.focus();
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('Enter');
      await (
        await chooser
      ).setFiles({ name: 'printer.log', mimeType: 'text/plain', buffer: Buffer.from('printed') });

      // Tab reaches the file's Remove button, and removing it gives focus back to Attach.
      const remove = page.getByRole('button', { name: 'Remove printer.log' });
      await pressUntilFocused(page, 'Tab', remove);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('list', { name: /to send$/ })).toBeHidden();
      await expect(attach).toBeFocused();
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
      await page.goto(await ownRequestPath('A status picked with the keyboard'));
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
      await page.goto(await ownRequestPath('A reply written large with the keyboard'));
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

    test('someone is mentioned with the keyboard, and Escape closes the list before the large view', async ({
      page,
    }) => {
      await page.goto(await ownRequestPath('A mention made with the keyboard'));
      const reply = await markdownEditor(page, 'Your reply');
      const list = page.getByRole('listbox', { name: 'People to mention' });
      /**
       * The option the text points at: the one Enter picks.
       *
       * @param text - The text the list belongs to.
       * @returns The option's name.
       */
      const pointedAt = (text: typeof reply) =>
        text.evaluate(
          (element) =>
            document.getElementById(element.getAttribute('aria-activedescendant') ?? '')
              ?.textContent ?? null,
        );

      // The text says it has a list, and typing "@" opens it without moving the focus.
      await expect(reply).toHaveAttribute('aria-haspopup', 'listbox');
      await reply.focus();
      await page.keyboard.type('@e2e');
      await expect(list).toBeVisible();
      await expect(reply).toBeFocused();
      await expect(reply).toHaveAttribute('aria-controls', (await list.getAttribute('id')) ?? '');

      // The arrow keys move through the people; the text points at the one they're on.
      const options = list.getByRole('option');
      const first = await options.nth(0).textContent();
      const second = await options.nth(1).textContent();
      await expect.poll(() => pointedAt(reply)).toBe(first);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => pointedAt(reply)).toBe(second);
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => pointedAt(reply)).toBe(first);

      // Escape closes the list and leaves the text as it is, with the focus.
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(reply).toBeFocused();
      await expect(reply).toHaveText('@e2e');
      await expect(reply).not.toHaveAttribute('aria-activedescendant');

      // Tab leaves the text also while the list is open, and the list closes.
      await page.keyboard.type(' @e2e');
      await expect(list).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(reply).not.toBeFocused();
      await expect(list).toBeHidden();

      // In the large view, Escape closes the list first and the view second.
      await page.keyboard.press('Shift+Tab');
      await expect(reply).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('End');
      await expect(page.getByRole('button', { name: 'Large view' })).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Your reply' });
      const large = dialog.getByRole('textbox', { name: 'Your reply' });
      await expect(large).toBeFocused();
      await page.keyboard.type(' @e2e adm');
      await expect(list.getByRole('option')).toHaveCount(0);
      await page.keyboard.type(' @e2e fin');
      await expect(list.getByRole('option')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(dialog).toBeVisible();
      await expect(large).toBeFocused();
      // Enter picks someone there as on the page.
      await page.keyboard.type(' @e2e fin');
      await page.keyboard.press('Enter');
      await expect(large.locator('[data-mention]')).toHaveText(`@${FINANCE_STAFF.name}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(reply.locator('[data-mention]')).toHaveText(`@${FINANCE_STAFF.name}`);
    });

    test('a reply is sent with the keyboard, and focus is never lost', async ({ page }) => {
      await page.goto(await ownRequestPath('A reply sent with the keyboard'));
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

      // The field, then Attach files (people can attach files), then its buttons. Sending keeps
      // focus on the button, which stays.
      const attach = page.getByRole('button', { name: 'Attach files' });
      await reply.focus();
      await page.keyboard.type('We are looking into it.');
      await page.keyboard.press('Tab');
      await expect(attach).toBeFocused();
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
      await expect(attach).toBeFocused();
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
      await page.keyboard.press('Tab');
      await expect(sendAndWait).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Reply sent.');
      await expect(sendAndWait).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: 'Conversation' })).toBeFocused();
    });

    test('a note is written on its tab with the keyboard, and focus stays on its button', async ({
      page,
    }) => {
      await page.goto(await ownRequestPath('A note written with the keyboard'));
      const write = page.getByRole('tablist', { name: 'Write' });
      const replyTab = write.getByRole('tab', { name: 'Reply' });
      const noteTab = write.getByRole('tab', { name: 'Internal note' });
      const add = page.getByRole('button', { name: 'Add note' });

      // The arrow keys move between the tabs and open the one they reach; Tab goes on into it.
      await replyTab.focus();
      expect(await cursorOf(noteTab)).toBe('pointer');
      await page.keyboard.press('ArrowRight');
      await expect(noteTab).toBeFocused();
      await expect(noteTab).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowLeft');
      await expect(replyTab).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('End');
      await expect(noteTab).toHaveAttribute('aria-selected', 'true');
      const note = await markdownEditor(page, 'Your note');
      // The toolbar is the first stop in the panel, then the text.
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Bold' }),
      ).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(note).toBeFocused();
      await page.keyboard.type('Checked the cable.');

      // Past Attach files (people can attach files), adding the note keeps focus on the button,
      // which stays.
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Attach files' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(add).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Note added.');
      await expect(note).toHaveText('');
      await expect(add).toBeFocused();
    });
  });

  test.describe('as the staff, on a request’s subscribers', () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies(adminCookies());
    });

    test('the subscribers dialog is worked with the keyboard, and returns focus', async ({
      page,
    }) => {
      await page.goto(await ownRequestPath('Subscribers changed with the keyboard'));
      const details = page.getByRole('region', { name: 'Details' });
      const change = details.getByRole('button', { name: 'Change subscribers' });
      const dialog = page.getByRole('dialog', { name: 'Change who’s subscribed' });
      const finance = dialog.getByRole('checkbox', { name: FINANCE_STAFF.name, exact: true });

      // Enter opens it with focus inside; Space ticks; Escape closes it without saving.
      await change.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(':focus')).toHaveCount(1);
      await finance.focus();
      await page.keyboard.press('Space');
      await expect(finance).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(change).toBeFocused();

      // Opened again it starts from the request as it is; Enter in it saves.
      await page.keyboard.press('Enter');
      await expect(finance).not.toBeChecked();
      await finance.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Subscribers saved.');
      await expect(dialog).toHaveCount(0);
      await expect(change).toBeFocused();
      // Whoever raised it, and now Finance.
      await expect(details.getByRole('button', { name: 'Show the 2 subscribers' })).toBeVisible();
    });
  });

  test.describe('as someone at the company', () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies(clientState.cookies);
    });

    test('the subscribers’ names open from their avatars, and Escape returns focus', async ({
      page,
    }) => {
      await page.goto(await ownRequestPath('Subscribers read with the keyboard'));
      // Whoever raised a request follows it.
      const avatars = page
        .getByRole('region', { name: 'Details' })
        .getByRole('button', { name: 'Show the 1 subscriber' });
      const names = page.getByRole('dialog', { name: 'Subscribers' });

      // Enter opens the names, with focus in the panel; Escape closes it and returns focus.
      await avatars.focus();
      await expect(avatars).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(names).toContainText(REQUESTS_CLIENT.name);
      await expect(avatars).toHaveAttribute('aria-expanded', 'true');
      await expect(names).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(names).toHaveCount(0);
      await expect(avatars).toBeFocused();

      // Space opens it too.
      await page.keyboard.press('Space');
      await expect(names).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(names).toHaveCount(0);
      await expect(avatars).toBeFocused();
    });

    test('unsubscribing and subscribing again keep focus on the one button', async ({ page }) => {
      await page.goto(await ownRequestPath('A request followed with the keyboard'));
      const details = page.getByRole('region', { name: 'Details' });
      // Whoever raised a request follows it.
      const unsubscribe = details.getByRole('button', { name: 'Unsubscribe' });
      const subscribe = details.getByRole('button', { name: 'Subscribe', exact: true });

      await unsubscribe.focus();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('You’re no longer subscribed to this request.');
      // The button says what it does now, and is still where the keyboard is.
      await expect(unsubscribe).toHaveCount(0);
      await expect(subscribe).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('You’re subscribed to this request.');
      await expect(unsubscribe).toBeFocused();
    });

    test('a description is edited with the keyboard, and focus returns to its Edit button', async ({
      page,
    }) => {
      await page.goto(await ownRequestPath('A description edited with the keyboard'));
      const description = page.getByRole('region', { name: 'Description' });
      const edit = description.getByRole('button', { name: 'Edit description' });
      const editor = description.getByRole('textbox', { name: 'Description' });
      const attach = description.getByRole('button', { name: 'Attach files' });
      const save = description.getByRole('button', { name: 'Save' });
      const cancel = description.getByRole('button', { name: 'Cancel' });

      // Edit opens the editor with focus in the text; Tab goes on to Attach files (people can
      // attach files), then Save, then Cancel.
      await edit.focus();
      await page.keyboard.press('Enter');
      await expect(editor).toHaveAttribute('contenteditable', 'true');
      await expect(editor).toBeFocused();
      await page.keyboard.type(' Not kept.');
      await page.keyboard.press('Tab');
      await expect(attach).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(save).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(cancel).toBeFocused();
      // Cancel puts the text back, with focus on the Edit button.
      await page.keyboard.press('Enter');
      await expect(editor).toHaveCount(0);
      await expect(description).not.toContainText('Not kept.');
      await expect(edit).toBeFocused();

      // Saving does the same, once the text is saved.
      await page.keyboard.press('Enter');
      await expect(editor).toHaveAttribute('contenteditable', 'true');
      await expect(editor).toBeFocused();
      await page.keyboard.type(' Kept.');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(save).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toasts(page)).toContainText('Changes saved.');
      await expect(description).toContainText('Kept.');
      await expect(edit).toBeFocused();
    });

    test('cancelling a request asks first, keeps focus inside and returns it', async ({ page }) => {
      await page.goto(await ownRequestPath('A request cancelled with the keyboard'));
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

test.describe('the board of requests', () => {
  test.use({ reducedMotion: 'reduce' });
  test.beforeEach(async ({ context }) => {
    await context.addCookies(adminCookies());
  });

  test('a card moves with its Move menu from the keyboard, and focus follows it to its new lane', async ({
    page,
  }) => {
    const title = `A card moved with the keyboard ${Date.now()}`;
    const number = await storeOwnRequest({ title });
    await page.goto(`/requests/board?q=${encodeURIComponent(title)}`);
    const move = boardLane(page, 'Open').getByRole('button', { name: `Move AD-${number}` });
    expect(await cursorOf(move)).toBe('pointer');

    // From the card's link, Tab reaches its Move button (the avatars are left out).
    await boardLane(page, 'Open').getByRole('link', { name: title }).focus();
    await page.keyboard.press('Tab');
    await expect(move).toBeFocused();

    // Escape closes the menu and changes nothing.
    await openWithEnter(move, 'menu');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(move).toBeFocused();

    // The arrow keys go through the lanes, and Enter moves the card to one.
    await move.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    const inProgress = page.getByRole('menuitem', { name: 'In progress' });
    await pressUntilFocused(page, 'ArrowDown', inProgress);
    await page.keyboard.press('Enter');
    await expect(toasts(page)).toContainText(`AD-${number} moved to In progress.`);
    const moved = boardLane(page, 'In progress').getByRole('button', { name: `Move AD-${number}` });
    await expect(moved).toBeFocused();
    await expect(moved).not.toHaveAttribute('aria-busy');
    await expect(boardLane(page, 'Open').getByRole('link', { name: title })).toHaveCount(0);
  });

  test('the lanes are reached and scrolled sideways with the keyboard', async ({ page }) => {
    await page.goto('/requests/board');
    const lanes = page.getByRole('group', { name: 'Lanes' });
    // Five columns don’t fit the content’s width here: the row scrolls, inside its own box.
    await expect
      .poll(() => lanes.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
    await expect(lanes).toHaveAttribute('tabindex', '0');
    await lanes.focus();
    await expect(lanes).toBeFocused();
    await expect.poll(() => outlineOf(lanes)).toEqual({ style: 'solid', width: '2px' });
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => lanes.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    // The page itself doesn't scroll sideways.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test('a button above the lanes jumps to a column, whose heading takes the focus', async ({
    page,
  }) => {
    await page.goto('/requests/board');
    const lanes = page.getByRole('group', { name: 'Lanes' });
    await expect
      .poll(() => lanes.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
    const jump = page.getByRole('navigation', { name: 'Jump to a lane' });
    /**
     * Whether a column is in full view inside the lanes' row.
     *
     * @param key - The column's key.
     * @returns Whether it is.
     */
    const inView = (key: string) =>
      lanes.evaluate((row, column) => {
        const box = row.getBoundingClientRect();
        const shown = row.querySelector(`[data-column="${column}"]`)?.getBoundingClientRect();
        return Boolean(shown && shown.left >= box.left - 1 && shown.right <= box.right + 1);
      }, key);
    /**
     * A column's own heading.
     *
     * @param key - The column's key.
     * @returns The heading.
     */
    const headingOf = (key: string) =>
      page.locator(`[data-column="${key}"]`).getByRole('heading', { level: 2 });

    // A button per column, each with its count.
    await expect(jump.getByRole('button')).toHaveText([
      /^Open\s*\d+/,
      /^To do\s*\d+/,
      /^In progress\s*\d+/,
      /^Waiting\s*\d+/,
      /^Closed\s*\d+/,
    ]);
    expect(await inView('closed')).toBe(false);
    const closed = jump.getByRole('button', { name: /^Closed, \d+ requests?$/ });
    expect(await cursorOf(closed)).toBe('pointer');
    await closed.focus();
    await page.keyboard.press('Enter');
    await expect(headingOf('closed')).toBeFocused();
    await expect
      .poll(() => outlineOf(headingOf('closed')))
      .toEqual({ style: 'solid', width: '2px' });
    await expect.poll(() => inView('closed')).toBe(true);

    // And back to the first column.
    await jump.getByRole('button', { name: /^Open, \d+ requests?$/ }).press('Enter');
    await expect(headingOf('open')).toBeFocused();
    await expect.poll(() => lanes.evaluate((element) => element.scrollLeft)).toBe(0);

    // The row of buttons comes before the lanes, which Tab reaches next.
    await closed.focus();
    await page.keyboard.press('Tab');
    await expect(lanes).toBeFocused();

    // On a screen where all five columns fit side by side, there's nothing to jump to: the row
    // hides, and focus that was on it moves to the main content rather than <body>.
    await closed.focus();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(jump).toBeHidden();
    await expect(page.locator('#main')).toBeFocused();
    await expect(lanes).not.toHaveAttribute('tabindex');
  });
});

test('a request’s activity view is chosen with the keyboard, focus staying on each menu’s button', async ({
  page,
}) => {
  // The view is saved with the account: start from everything, oldest first, also on a retry.
  await resetActivityView(ACTIVITY_CLIENT.email);
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: ACTIVITY_CLIENT.email,
    title: 'Activity read with the keyboard',
  });
  await storeEntries(number, [
    { kind: 'comment', by: ACTIVITY_CLIENT.email, side: 'company', text: 'Any news?' },
    { kind: 'status', by: SUPPORT_STAFF.email, side: 'staff', from: 'open', to: 'in_progress' },
  ]);
  await signIn(page, ACTIVITY_CLIENT);
  await page.goto(`/requests/${number}`);
  const entries = page.getByRole('region', { name: 'Conversation' }).locator('ol > li');
  await expect(entries).toHaveCount(2);

  // Enter opens the Show menu on "Everything"; the arrow keys go down the groups.
  const show = page.getByRole('button', { name: 'Show: Everything' });
  expect(await cursorOf(show)).toBe('pointer');
  await show.focus();
  await openWithEnter(show, 'menu');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Everything' })).toBeFocused();
  const status = page.getByRole('menuitemcheckbox', { name: 'Status changes' });
  await pressUntilFocused(page, 'ArrowDown', status);
  expect(await cursorOf(status)).toBe('pointer');

  // Space unticks it and the menu stays open, still on it.
  await page.keyboard.press('Space');
  await expect(status).not.toBeChecked();
  await expect(status).toBeFocused();

  // Escape closes it, and focus is back on its button, which says what's shown. (The open menu
  // hides the rest of the page from screen readers, so the activity is read after it closes.)
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show: Replies and Other changes' })).toBeFocused();
  await expect(entries).toHaveCount(1);

  // Tab goes on to the order; Enter picks the newest first and closes it, focus on its button.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Oldest first' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: 'Oldest first' })).toBeFocused();
  const newest = page.getByRole('menuitemradio', { name: 'Newest first' });
  await pressUntilFocused(page, 'ArrowDown', newest);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Newest first' })).toBeFocused();
});
