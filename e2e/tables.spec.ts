/**
 * @file End-to-end tests for sortable, paginated tables, on the members page
 * of the seeded paging company (30 members, 12 invite links): page links and
 * sizes, sorting from the Sort menu (with `aria-sort` on the headers), each
 * table keeping its own state in the address, and query parameters it doesn't
 * know. Also checks that no table scrolls sideways from tablet to desktop
 * widths.
 */
import { type Page } from '@playwright/test';

import { findUserId, storeRequest } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_SLUG,
  NAMELESS_SUPPORT,
  PAGED_LINK_COUNT,
  PAGED_MEMBER_COUNT,
  pagedMemberEmail,
  pagedMemberName,
  PAGING_COMPANY_NAME,
  PAGING_COMPANY_SLUG,
  PLATFORM_ADMIN,
  REQUESTS_CLIENT,
} from './support/fixtures';
import { adminStorageState, type StorageState } from './support/helpers';
import { expect, test } from './support/test';

/** Sign-in cookies of the staff Admin. */
let adminState: StorageState;

/** The paging company's members page, at the address the app links to (its URL name). */
const membersPath = `/companies/${PAGING_COMPANY_SLUG}/members`;

test.beforeAll(async ({ browser }) => {
  adminState = await adminStorageState(browser);
});

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ context }) => {
  await context.addCookies(adminState.cookies);
});

/**
 * The members table.
 *
 * @param page - The browser page.
 * @returns The table.
 */
const membersTable = (page: Page) =>
  page.getByRole('table', { name: new RegExp(`^Members of ${PAGING_COMPANY_NAME}`) });

/**
 * The members table's rows (without its header row).
 *
 * @param page - The browser page.
 * @returns The rows.
 */
const memberRows = (page: Page) => membersTable(page).locator('tbody tr');

/**
 * The status line of a table's pagination, e.g. "Showing 1–25 of 30".
 *
 * @param page - The browser page.
 * @param text - The text it should have.
 * @returns The status line.
 */
const summary = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: new RegExp(`^${text}$`) });

test('pages through a long list and changes the page size', async ({ page }) => {
  await page.goto(membersPath);
  const pages = page.getByRole('navigation', { name: 'Pages of members' });

  await expect(summary(page, `Showing 1–25 of ${PAGED_MEMBER_COUNT}`)).toBeVisible();
  await expect(memberRows(page)).toHaveCount(25);
  await expect(pages.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await expect(pages.getByRole('link', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');

  await pages.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(`${membersPath}?page=2`);
  await expect(
    summary(page, `Showing 26–${PAGED_MEMBER_COUNT} of ${PAGED_MEMBER_COUNT}`),
  ).toBeVisible();
  await expect(memberRows(page)).toHaveCount(5);
  await expect(memberRows(page).first()).toContainText(pagedMemberName(26));
  await expect(pages.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await expect(membersTable(page)).toHaveAccessibleName(/, page 2 of 2$/);

  // A bigger page starts at the first one again and needs no page links.
  await page
    .getByRole('group', { name: /^Per page, members/ })
    .getByRole('link', { name: '50 per page' })
    .click();
  await expect(page).toHaveURL(`${membersPath}?size=50`);
  await expect(
    summary(page, `Showing 1–${PAGED_MEMBER_COUNT} of ${PAGED_MEMBER_COUNT}`),
  ).toBeVisible();
  await expect(memberRows(page)).toHaveCount(30);
  await expect(pages).toHaveCount(0);
});

test('sorts from the Sort menu, back on the first page, and the headers say how', async ({
  page,
}) => {
  await page.goto(`${membersPath}?page=2`);
  const table = membersTable(page);
  const name = table.getByRole('columnheader', { name: 'Name' });
  const activity = table.getByRole('columnheader', { name: 'Activity' });
  const sortMenu = page.getByRole('button', { name: /^Sort members/ });
  /**
   * Picks a way to sort from the Sort menu.
   *
   * @param label - The choice, e.g. "Joined, newest first".
   */
  const sortBy = async (label: string) => {
    await sortMenu.click();
    await page.getByRole('menuitemradio', { name: label }).click();
  };
  // Headers aren't links: they only tell screen readers how the table is sorted.
  await expect(table.getByRole('columnheader').getByRole('link')).toHaveCount(0);
  await expect(name).toHaveAttribute('aria-sort', 'ascending');
  await expect(activity).not.toHaveAttribute('aria-sort');
  await expect(sortMenu).toHaveAccessibleName('Sort members: Name, A to Z');

  // The Activity column shows when they joined, so it's the sorted one.
  await sortBy('Joined, newest first');
  await expect(page).toHaveURL(`${membersPath}?sort=joined`);
  await expect(activity).toHaveAttribute('aria-sort', 'descending');
  await expect(name).not.toHaveAttribute('aria-sort');
  await expect(memberRows(page).first()).toContainText(pagedMemberName(30));
  await expect(table).toHaveAccessibleName(/sorted by Joined, newest first/);
  await expect(sortMenu).toHaveAccessibleName('Sort members: Joined, newest first');

  await sortBy('Joined, oldest first');
  await expect(page).toHaveURL(`${membersPath}?sort=joined&dir=asc`);
  await expect(activity).toHaveAttribute('aria-sort', 'ascending');
  await expect(memberRows(page).first()).toContainText(pagedMemberName(1));

  // The addresses are in the Name column, so sorting by them marks it.
  await sortBy('Email, Z to A');
  await expect(page).toHaveURL(`${membersPath}?sort=email&dir=desc`);
  await expect(name).toHaveAttribute('aria-sort', 'descending');
  await expect(memberRows(page).first()).toContainText(pagedMemberEmail(30));

  // Back to the default order leaves nothing in the address.
  await sortBy('Name, A to Z');
  await expect(page).toHaveURL(membersPath);
  await expect(name).toHaveAttribute('aria-sort', 'ascending');

  await page.goBack();
  await expect(page).toHaveURL(`${membersPath}?sort=email&dir=desc`);
  await expect(name).toHaveAttribute('aria-sort', 'descending');
});

test("keeps each table's sort and page in the address", async ({ page }) => {
  await page.goto(`${membersPath}?page=2`);
  const links = page.getByRole('table', { name: /^Invite links/ });
  await expect(summary(page, `Showing 1–${PAGED_LINK_COUNT} of ${PAGED_LINK_COUNT}`)).toBeVisible();

  const sortLinks = page.getByRole('button', { name: /^Sort invite links/ });
  await sortLinks.click();
  await page.getByRole('menuitemradio', { name: 'Created, oldest first' }).click();
  // Ends in the card's anchor (for a link opened in a new tab); here the page doesn't move, and
  // focus goes back to the Sort button.
  await expect(page).toHaveURL(`${membersPath}?page=2&links-dir=asc#company-invite-links`);
  await expect(links.getByRole('columnheader', { name: 'Created' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(sortLinks).toBeFocused();
  // The members table stays on its second page.
  await expect(memberRows(page)).toHaveCount(5);
});

test("shows the last page for one past it, and ignores what it doesn't know", async ({ page }) => {
  await page.goto(`${membersPath}?page=99`);
  await expect(
    summary(page, `Showing 26–${PAGED_MEMBER_COUNT} of ${PAGED_MEMBER_COUNT}`),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Pages of members' })
      .getByRole('link', { name: 'Page 2' }),
  ).toHaveAttribute('aria-current', 'page');

  await page.goto(`${membersPath}?sort=bogus&dir=up&size=7`);
  await expect(summary(page, `Showing 1–25 of ${PAGED_MEMBER_COUNT}`)).toBeVisible();
  await expect(membersTable(page).getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('sorts from the Sort menu, where the Activity column is hidden', async ({ page }) => {
    await page.goto(membersPath);
    await expect(membersTable(page).getByRole('columnheader', { name: 'Activity' })).toBeHidden();
    // The activity goes under the name instead.
    await expect(memberRows(page).first()).toContainText(/Last active never\s*Joined/);

    await page.getByRole('button', { name: 'Sort members' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio', { name: 'Name, A to Z' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await menu.getByRole('menuitemradio', { name: 'Joined, newest first' }).click();
    await expect(page).toHaveURL(`${membersPath}?sort=joined`);
    await expect(memberRows(page).first()).toContainText(pagedMemberName(30));
  });
});

test('no table scrolls sideways from tablet to desktop widths', async ({ page }) => {
  // Twelve pages at six widths, one after another.
  test.setTimeout(150_000);
  const userId = await findUserId(CLIENT_WATCHER.email);
  // The Admin is signed in, so their own page lists at least one device.
  const adminId = await findUserId(PLATFORM_ADMIN.email);
  // The longest status the staff see, "Waiting for the company", on the first page of every list
  // of requests below: stored now, so its activity is the latest, whatever other specs stored.
  await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'Waiting while the tables are measured',
    status: 'waiting',
  });
  // The staff member with no name and a long address is the widest row.
  const paths = [
    '/admin/users',
    `/admin/users?${new URLSearchParams({ q: NAMELESS_SUPPORT.email })}`,
    '/admin/settings/staff',
    '/admin/companies',
    membersPath,
    `/admin/users/${userId}/companies`,
    `/admin/users/${adminId}/activity`,
    '/account/activity',
    // Every request, with the staff's Priority column and the longest status.
    '/requests?status=all',
    // A lane's link from the board: only the requests that wait for the company.
    '/requests?only=waiting',
    // A company's own requests, under its header and tabs: a full page of 25, and the company
    // with the waiting request.
    `/companies/${PAGING_COMPANY_SLUG}`,
    `/companies/${COMPANY_SLUG}`,
  ];

  // From 1280px the content stops getting wider, so wider screens must fit the same columns.
  await [640, 768, 1024, 1280, 1536, 1920].reduce(async (previousWidth, width) => {
    await previousWidth;
    await page.setViewportSize({ width, height: 900 });
    await paths.reduce(async (previousPath, path) => {
      await previousPath;
      await page.goto(path);
      await expect(page.getByRole('main').getByRole('table').first()).toBeVisible();
      const overflowing = await page.evaluate(() =>
        [...document.querySelectorAll('main table')]
          .filter((table) => {
            // In the browser: the helpers above aren't available here.
            const box = table.parentElement;
            return box !== null && box.scrollWidth > box.clientWidth;
          })
          .map((table) => table.querySelector('caption')?.textContent),
      );
      expect(overflowing, `${path} at ${width}px`).toEqual([]);
    }, Promise.resolve());
  }, Promise.resolve());
});
