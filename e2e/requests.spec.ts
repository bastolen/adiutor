/**
 * @file End-to-end tests for requests: the list with its filters, search,
 * sorting and pages, and what it says without requests, raising a request
 * (someone at a company, and the staff
 * for a company), and a request's page: its description, details and
 * conversation, the staff and a company working a request through (status,
 * replies, done, reopened, cancelled), the staff editing its details and
 * assigning it (and finding what's assigned to them), editing a
 * description or a reply (and the earlier versions the staff read), the
 * staff's internal notes (which Finance reads and the company never sees),
 * the
 * prefix numbers are shown with, and
 * who only reads: Watchers, Finance, and everyone for a deactivated
 * company's request; and a staff member signed in as a user, who replies for
 * them.
 * The staff reach a person's user page from their name; nobody at a company
 * does.
 * The board: switching to it, moving a card with its Move menu, Done and
 * Cancelled asking first, a move from a board that's out of date, and a
 * lane's link to the list of all its requests.
 * Each test that changes a request stores its own (`storeRequest`); the
 * seeded ones are only read.
 */
import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { defined } from '../src/lib/defined';
import {
  createCompany,
  findCompanyId,
  findUserId,
  resetActivityView,
  setRequestPrefix,
  setStoredRequestStatus,
  storeEntries,
  storeInvitation,
  storeRequest,
} from './support/db';
import {
  ACTIVITY_SUPPORT,
  CLIENT_WATCHER,
  CLOSED_COMPANY_NAME,
  COMPANY_NAME,
  COMPANY_SLUG,
  E2E_BASE_URL,
  FINANCE_STAFF,
  FIRST_PAGED_REQUEST_NUMBER,
  PAGED_REQUEST_COUNT,
  pagedRequestTitle,
  PAGING_COMPANY_NAME,
  PAGING_COMPANY_SLUG,
  PLATFORM_ADMIN,
  PLATFORM_MANAGER,
  REQUESTS_CLIENT,
  SEEDED_REQUESTS,
  STAFF_NAME,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  clickLinkInEmail,
  createAccountFromInvitation,
  freshAddress,
  markdownEditor,
  setUpAuthenticator,
  signIn,
  signInAsUser,
  signOut,
  toasts,
} from './support/helpers';
import { emailsAbout, linkIn, waitForEmailAbout } from './support/outbox';
import { expect, test } from './support/test';

/**
 * The conversation of the request on the page.
 *
 * @param page - The browser page.
 * @returns The list of its entries.
 */
const conversation = (page: Page) =>
  page.getByRole('region', { name: 'Conversation' }).getByRole('list');

/**
 * The page's main content.
 *
 * @param page - The browser page.
 * @returns It.
 */
const main = (page: Page) => page.getByRole('main');

/**
 * The value of one of the request's details, in the bar next to its conversation.
 *
 * @param page - The browser page.
 * @param term - The detail's name, e.g. "Status".
 * @returns The element with its value.
 */
const detail = (page: Page, term: string) =>
  page
    .getByRole('region', { name: 'Details' })
    .locator('dt', { hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');

/**
 * Checks that a request's page offers nothing to change the request with.
 * Following it is still its reader's own: that button isn't looked at here.
 *
 * @param page - The browser page, on a request.
 */
async function expectReadOnly(page: Page) {
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveCount(0);
  await expect(
    main(page).getByRole('button', {
      name: /^(Send reply|Mark as done|Cancel request|Reopen|Edit details|Edit description|Edit reply|Assign to me|Change assignees)$/,
    }),
  ).toHaveCount(0);
}

/**
 * The rows of the request list on the page.
 *
 * @param page - The browser page.
 * @returns The table's body rows.
 */
const requestRows = (page: Page) => main(page).getByRole('table').locator('tbody tr');

test('the staff find every company’s requests, and narrow them down', async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);
  await page.goto('/requests');
  await expect(page).toHaveTitle('Requests · Adiutor');
  await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();

  // What still needs something, the latest activity on top; nothing closed. How many pages it has
  // depends on what other specs stored.
  const table = main(page).getByRole('table');
  await expect(table).toHaveAccessibleName(
    /^Active requests, sorted by Last activity, most recent first, page 1 of \d+$/,
  );
  // The staff see each request's priority.
  await expect(table.getByRole('columnheader', { name: 'Priority' })).toBeVisible();
  await expect(main(page).getByText(SEEDED_REQUESTS.done.title)).toHaveCount(0);

  // The ones that wait for the company, each with its number and company.
  const filters = page.getByRole('navigation', { name: 'Filter requests by status' });
  await filters.getByRole('link', { name: 'Waiting' }).click();
  await expect(page).toHaveURL('/requests?status=waiting');
  const waiting = requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title });
  await expect(waiting).toContainText('AD-1');
  await expect(waiting).toContainText(COMPANY_NAME);
  await expect(waiting).toContainText('Waiting for the company');
  await filters.getByRole('link', { name: 'Active' }).click();
  await expect(page).toHaveURL('/requests');

  // A deactivated company's requests can't be worked on, so they aren't among the active ones.
  await page.getByRole('searchbox', { name: 'Search requests' }).fill('SSL');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(main(page).getByText('No matching requests')).toBeVisible();

  // Every status: the closed company's request and the done one are there.
  await filters.getByRole('link', { name: 'All', exact: true }).click();
  await expect(page).toHaveURL('/requests?status=all&q=SSL');
  await expect(requestRows(page)).toHaveCount(1);
  await expect(requestRows(page).first()).toContainText(SEEDED_REQUESTS.closedCompany.title);

  // By number, with any prefix or none: every request whose number starts with what was typed,
  // so request 3 and 30, not 13. (Other specs add requests, so the rows aren't counted.)
  await page.getByRole('searchbox', { name: 'Search requests' }).fill('ad-3');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL('/requests?status=all&q=ad-3');
  const third = requestRows(page).filter({ hasText: SEEDED_REQUESTS.done.title });
  await expect(third).toContainText('AD-3');
  await expect(third).toContainText('Done');
  await expect(
    requestRows(page).filter({ hasText: pagedRequestTitle(30 - FIRST_PAGED_REQUEST_NUMBER + 1) }),
  ).toContainText('AD-30');
  await expect(
    main(page).getByText(pagedRequestTitle(13 - FIRST_PAGED_REQUEST_NUMBER + 1)),
  ).toHaveCount(0);
  // The whole number finds the one request.
  await page.getByRole('searchbox', { name: 'Search requests' }).fill('AD-30');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(requestRows(page)).toHaveCount(1);
  await expect(requestRows(page).first()).toContainText('AD-30');

  // Waiting, closed, and the menus next to Sort.
  await page.goto('/requests');
  await filters.getByRole('link', { name: 'Closed' }).click();
  await expect(page).toHaveURL('/requests?status=closed');
  // Other specs close requests of their own, so only the seeded ones are looked for.
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.done.title })).toHaveCount(1);
  await expect(main(page).getByText(SEEDED_REQUESTS.open.title)).toHaveCount(0);

  await page.goto('/requests');
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Hotfix' }).click();
  await expect(page).toHaveURL('/requests?type=hotfix');
  await expect(page.getByRole('button', { name: 'Type: Hotfix' })).toBeFocused();
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.reopened.title })).toHaveCount(
    1,
  );
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.reopened.title })).toContainText(
    'Reopened',
  );
  await expect(main(page).getByText(SEEDED_REQUESTS.open.title)).toHaveCount(0);

  await page.getByRole('button', { name: 'Priority', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Low' }).click();
  await expect(page).toHaveURL('/requests?type=hotfix&priority=low');
  await expect(main(page).getByText('No matching requests')).toBeVisible();

  // One company's requests, more than fit on a page, raised first to last.
  await page.goto('/requests');
  await page.getByRole('button', { name: 'Company', exact: true }).click();
  await page.getByRole('menuitemradio', { name: PAGING_COMPANY_NAME }).click();
  await expect(page).toHaveURL(`/requests?company=${PAGING_COMPANY_SLUG}`);
  await expect(main(page).getByText(`Showing 1–25 of ${PAGED_REQUEST_COUNT}`)).toBeVisible();
  await page.getByRole('button', { name: /^Sort\s*requests/ }).click();
  await page.getByRole('menuitemradio', { name: 'Raised, oldest first' }).click();
  await expect(page).toHaveURL(`/requests?company=${PAGING_COMPANY_SLUG}&sort=raised&dir=asc`);
  await expect(requestRows(page).first()).toContainText(pagedRequestTitle(1));
  await expect(requestRows(page).first()).toContainText(`AD-${FIRST_PAGED_REQUEST_NUMBER}`);
  await main(page).getByRole('link', { name: 'Next page' }).click();
  await expect(requestRows(page)).toHaveCount(PAGED_REQUEST_COUNT - 25);
  await expect(requestRows(page).last()).toContainText(pagedRequestTitle(PAGED_REQUEST_COUNT));

  // A row is one link to its request.
  await requestRows(page).last().getByRole('link').click();
  await expect(page).toHaveURL(`/requests/${FIRST_PAGED_REQUEST_NUMBER + PAGED_REQUEST_COUNT - 1}`);
  // The menu's Requests item stays current on a request, and the page links back to the list.
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Requests' }),
  ).toHaveAttribute('aria-current', 'page');
  await main(page).getByRole('link', { name: 'Requests', exact: true }).click();
  await expect(page).toHaveURL('/requests');
});

test('a changed prefix shows on every number, and the old one still finds a request', async ({
  page,
}) => {
  await signIn(page, SUPPORT_STAFF);
  // Changed straight in the database (the staff page's field is tested in `staff.spec.ts`), and
  // put back whatever happens: every other test reads "AD".
  await setRequestPrefix('HELP');
  try {
    await page.goto('/requests?status=waiting');
    const waiting = requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title });
    await expect(waiting).toContainText(`HELP-${SEEDED_REQUESTS.waiting.number}`);
    await expect(main(page).getByText(/\bAD-\d/)).toHaveCount(0);

    // Numbers people noted before the change still find their request.
    await page
      .getByRole('searchbox', { name: 'Search requests' })
      .fill(`AD-${SEEDED_REQUESTS.waiting.number}`);
    await page.getByRole('button', { name: 'Search' }).click();
    const found = requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title });
    await expect(found).toHaveCount(1);

    // A short link counts the current prefix only: the old one names no request any more.
    await page.goto(`/r/HELP-${SEEDED_REQUESTS.waiting.number}`);
    await expect(page).toHaveURL(`/requests/${SEEDED_REQUESTS.waiting.number}`);
    await page.goto(`/r/AD-${SEEDED_REQUESTS.waiting.number}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.goto('/requests?status=all');
    await page
      .getByRole('searchbox', { name: 'Search requests' })
      .fill(`AD-${SEEDED_REQUESTS.waiting.number}`);
    await page.getByRole('button', { name: 'Search' }).click();

    // The request's address has no prefix, so it stays; its page and title show the new one.
    await found.getByRole('link').click();
    await expect(page).toHaveURL(`/requests/${SEEDED_REQUESTS.waiting.number}`);
    await expect(page).toHaveTitle(`Request HELP-${SEEDED_REQUESTS.waiting.number} · Adiutor`);
    // Only the page shown counts: Next keeps the list alive, hidden, with the number in its row.
    await expect(
      main(page)
        .getByText(`HELP-${SEEDED_REQUESTS.waiting.number}`, { exact: true })
        .filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      main(page)
        .getByText(/\bAD-\d/)
        .filter({ visible: true }),
    ).toHaveCount(0);
  } finally {
    await setRequestPrefix('AD');
  }
  await page.reload();
  await expect(page).toHaveTitle(`Request AD-${SEEDED_REQUESTS.waiting.number} · Adiutor`);
});

test('the number as people see it, and the short links, open the request', async ({ page }) => {
  await signIn(page, REQUESTS_CLIENT);
  const { number, title } = SEEDED_REQUESTS.waiting;

  for (const address of [
    `/requests/AD-${number}`,
    `/requests/ad-${number}`,
    `/r/AD-${number}`,
    `/r/${number}`,
  ]) {
    // eslint-disable-next-line no-await-in-loop -- One address after another, in one browser.
    await page.goto(address);
    // eslint-disable-next-line no-await-in-loop -- Checked for each address.
    await expect(page).toHaveURL(`/requests/${number}`);
    // eslint-disable-next-line no-await-in-loop -- Checked for each address.
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }

  // Another prefix, or anything that isn't a request number, names no request.
  for (const address of [`/r/XY-${number}`, '/r/abc', `/requests/XY-${number}`]) {
    // eslint-disable-next-line no-await-in-loop -- One address after another, in one browser.
    await page.goto(address);
    // eslint-disable-next-line no-await-in-loop -- Checked for each address.
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  }
});

test('someone at a company sees its requests only, without priorities', async ({ page }) => {
  await signIn(page, REQUESTS_CLIENT);
  // The seeded requests, found by their titles: other specs store newer ones in this company.
  await page.goto(`/requests?status=all&q=${encodeURIComponent(SEEDED_REQUESTS.waiting.title)}`);
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title })).toContainText(
    'Waiting for your reply',
  );
  await page.goto(`/requests?status=all&q=${encodeURIComponent(SEEDED_REQUESTS.done.title)}`);
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.done.title })).toBeVisible();
  await page.goto('/requests?status=all');
  // Nothing of other companies, and no way to ask for it.
  await expect(main(page).getByText('Paged request')).toHaveCount(0);
  await expect(main(page).getByText(SEEDED_REQUESTS.closedCompany.title)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Company', exact: true })).toHaveCount(0);
  const waitingTitle = encodeURIComponent(SEEDED_REQUESTS.waiting.title);
  await page.goto(`/requests?status=all&company=${PAGING_COMPANY_SLUG}`);
  await expect(main(page).getByText('Paged request')).toHaveCount(0);
  await page.goto(`/requests?status=all&company=${PAGING_COMPANY_SLUG}&q=${waitingTitle}`);
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title })).toBeVisible();

  // No priority: no column, no filter, no sort, and asking for one changes nothing.
  await expect(main(page).getByText(/priority/i)).toHaveCount(0);
  await page.getByRole('button', { name: /^Sort\s*requests/ }).click();
  await expect(page.getByRole('menuitemradio', { name: /Priority/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto(`/requests?status=all&priority=low&sort=priority&q=${waitingTitle}`);
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title })).toBeVisible();
  // Sorted by last activity, not by priority, whatever the address asks.
  await expect(main(page).getByRole('table')).toHaveAccessibleName(
    /^All requests matching “.+”, sorted by Last activity, most recent first$/,
  );
});

test('someone at a company raises a request, which the staff then find', async ({ page }) => {
  await signIn(page, REQUESTS_CLIENT);
  await page.goto('/requests');
  await main(page).getByRole('link', { name: 'New request' }).click();
  await expect(page).toHaveURL('/requests/new');
  await expect(page).toHaveTitle('New request · Adiutor');
  // One company, so nothing to choose; and no priority to set.
  await expect(page.getByRole('combobox', { name: 'Company' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Priority' })).toHaveCount(0);

  // Without a type it's refused, and what was typed stays.
  await page.getByRole('textbox', { name: 'Title' }).fill('The coffee machine app is offline');
  await page
    .getByRole('textbox', { name: 'Description' })
    .fill('It says “no connection”.\nSee https://adiutor.test/coffee for the manual.');
  await page.getByRole('button', { name: 'Raise request' }).click();
  await expect(main(page).getByRole('alert')).toContainText('Choose what kind of request this is.');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'The coffee machine app is offline',
  );

  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: /^Bug/ }).click();
  await page.getByRole('button', { name: 'Raise request' }).click();

  // It opens on its own page, which says so once: the address doesn't ask for it again.
  await expect(toasts(page)).toContainText('Request raised.');
  await expect(page).toHaveURL(/\/requests\/\d+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'The coffee machine app is offline' }),
  ).toBeVisible();
  const description = page.getByRole('region', { name: 'Description' });
  await expect(description).toContainText('It says “no connection”.');
  await expect(description.getByRole('link', { name: /adiutor\.test\/coffee/ })).toBeVisible();
  await expect(detail(page, 'Status')).toHaveText('Open');
  await expect(detail(page, 'Type')).toHaveText('Bug');
  await expect(detail(page, 'Raised by')).toContainText('You');
  const number = new URL(page.url()).pathname.split('/').pop();

  // Back finds the form empty, not filled in and ready to raise the request a second time,
  // and the list before it with the new request: neither page is shown as it was kept.
  await page.goBack();
  await expect(page).toHaveURL('/requests/new');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  await expect(await markdownEditor(page, 'Description')).toHaveText('');
  await page.goBack();
  await expect(page).toHaveURL('/requests');
  await expect(
    requestRows(page).filter({ hasText: 'The coffee machine app is offline' }).first(),
  ).toContainText(`AD-${number}`);
  await signOut(page);

  // The staff find it at the top of the list, with the priority its type gave it.
  await signIn(page, SUPPORT_STAFF);
  await page.goto('/requests');
  await expect(requestRows(page).first()).toContainText('The coffee machine app is offline');
  await expect(requestRows(page).first()).toContainText(`AD-${number}`);
  await requestRows(page).first().getByRole('link').click();
  await expect(detail(page, 'Priority')).toHaveText('Normal');
  await expect(detail(page, 'Raised by')).toContainText(REQUESTS_CLIENT.name);
});

test('the staff raise a request for a company and choose its priority', async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);
  // Without a company it's a field to fill in, not a page that doesn't exist.
  await page.goto('/requests/new');
  await expect(page.getByRole('combobox', { name: 'Company' })).toHaveText('Choose a company');
  await page.getByRole('textbox', { name: 'Title' }).fill('Add a colleague to the mailing list');
  await page.getByRole('textbox', { name: 'Description' }).fill('Asked by phone.');
  await page.getByRole('button', { name: 'Raise request' }).click();
  await expect(main(page).getByRole('alert')).toContainText(
    'Choose which company this request is for.',
  );

  // From a company's own list the company is chosen already. Other specs add companies with the
  // same name, and then the select names it by its URL name too.
  const chosen = new RegExp(`^${COMPANY_NAME}( \\(${COMPANY_SLUG}\\))?$`);
  await page.goto(`/requests/new?company=${COMPANY_SLUG}`);
  await expect(page.getByRole('combobox', { name: 'Company' })).toHaveText(chosen);
  // A deactivated company's requests can only be read, so it isn't offered.
  await page.getByRole('combobox', { name: 'Company' }).click();
  await expect(page.getByRole('option', { name: CLOSED_COMPANY_NAME })).toHaveCount(0);
  // The chosen company stays chosen. It isn't picked from the list by its name, which other
  // companies share.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: 'Company' })).toHaveText(chosen);

  await page.getByRole('textbox', { name: 'Title' }).fill('Add a colleague to the mailing list');
  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: /^New feature/ }).click();
  await page.getByRole('textbox', { name: 'Description' }).fill('Asked by phone.');
  await expect(page.getByRole('combobox', { name: 'Priority' })).toHaveText('Set by the type');
  await page.getByRole('combobox', { name: 'Priority' }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await page.getByRole('button', { name: 'Raise request' }).click();

  await expect(toasts(page)).toContainText('Request raised.');
  await expect(page).toHaveURL(/\/requests\/\d+$/);
  await expect(detail(page, 'Priority')).toHaveText('High');
  await expect(detail(page, 'Company')).toHaveText(COMPANY_NAME);
  // Raised by the staff, so there's no first response to wait for.
  await expect(detail(page, 'Raised by')).toContainText(STAFF_NAME);
  await expect(page.getByRole('region', { name: 'Details' })).not.toContainText('First response');

  // Loading the page again doesn't say it was raised a second time. The dialog opens once the
  // page works again, which is when a toast would have come.
  await page.reload();
  await expect(detail(page, 'Priority')).toHaveText('High');
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit this request’s details' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(toasts(page).getByText('Request raised.')).toHaveCount(0);
});

test('a company without requests invites its first one, under All too', async ({ page }) => {
  // A company of this test's own, so no other spec raises a request in it.
  const slug = `adiutor-tests-first-${randomUUID().slice(0, 8)}`;
  await createCompany({ name: 'Adiutor Tests First', slug });
  await signIn(page, SUPPORT_STAFF);

  await page.goto(`/companies/${slug}`);
  await expect(main(page).getByText('No active requests')).toBeVisible();

  // All leaves nothing out: it isn't that nothing matches, there are no requests yet.
  const filters = page.getByRole('navigation', { name: 'Filter requests by status' });
  await filters.getByRole('link', { name: 'All' }).click();
  await expect(page).toHaveURL(`/companies/${slug}?status=all`);
  await expect(main(page).getByText('No requests yet')).toBeVisible();
  await expect(main(page).getByText('Raise the first request and it shows up here.')).toBeVisible();
  await expect(main(page).getByText('No matching requests')).toHaveCount(0);

  // Closed narrows the list down, so there nothing matches.
  await filters.getByRole('link', { name: 'Closed' }).click();
  await expect(main(page).getByText('No matching requests')).toBeVisible();

  // The invitation under All opens the form for this company.
  await filters.getByRole('link', { name: 'All' }).click();
  await expect(main(page).getByText('No requests yet')).toBeVisible();
  await main(page).getByRole('link', { name: 'New request' }).last().click();
  await expect(page).toHaveURL(`/requests/new?company=${slug}`);
});

test('nobody raises a request who may not: a Watcher and Finance get no form', async ({ page }) => {
  // A Watcher of this test's own, who is in no other company: other specs make the seeded
  // Watcher a Client elsewhere, where they may raise requests.
  await page.goto(
    await storeInvitation({
      companyId: await findCompanyId(COMPANY_SLUG),
      email: freshAddress('requests-watcher'),
      role: 'watcher',
    }),
  );
  await createAccountFromInvitation(page, 'Reads Only Tester', 'reads-only-tester-password');
  // The seeded request, found by its title: other specs store newer ones in this company.
  await page.goto(`/requests?q=${encodeURIComponent(SEEDED_REQUESTS.waiting.title)}`);
  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title })).toBeVisible();
  // The list words it as the request's page does: it waits for their company, not for them.
  const waiting = requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title });
  await expect(waiting).toContainText('Waiting for your company');
  await expect(waiting).not.toContainText('Waiting for your reply');
  await expect(main(page).getByRole('link', { name: 'New request' })).toHaveCount(0);
  await page.goto('/requests/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page).toHaveTitle('Not found · Adiutor');
  await signOut(page);

  await signIn(page, FINANCE_STAFF);
  await page.goto('/requests');
  await expect(main(page).getByRole('link', { name: 'New request' })).toHaveCount(0);
  await page.goto('/requests/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

test('the staff and a company work a request through, and close and reopen it', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'The scanner on floor 3 is offline',
    description: 'It shows a red light since this morning.',
  });

  // The staff accept it, ask a question and wait for the answer.
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await expect(page).toHaveTitle(`Request AD-${number} · Adiutor`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'The scanner on floor 3 is offline' }),
  ).toBeVisible();
  // What was asked has a card of its own, with who asked it.
  const description = page.getByRole('region', { name: 'Description' });
  await expect(description).toContainText('It shows a red light since this morning.');
  await expect(description).toContainText(REQUESTS_CLIENT.name);
  // Nobody replied yet.
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('No replies yet.');
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText('Not yet');
  const status = page.getByRole('combobox', { name: 'Status' });
  await expect(status).toHaveText('Open');
  await status.click();
  await page.getByRole('option', { name: 'To do' }).click();
  await expect(toasts(page)).toContainText('Status saved.');
  await expect(status).toHaveText('To do');
  await expect(status).toBeFocused();
  await expect(conversation(page)).toContainText('Changed the status from Open to To do.');

  await page
    .getByRole('textbox', { name: 'Your reply' })
    .fill('Is it plugged in?\nAnd which floor?');
  await page.getByRole('button', { name: 'Send and wait for the company' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(await markdownEditor(page, 'Your reply')).toHaveText('');
  await expect(status).toHaveText('Waiting for the company');
  await expect(conversation(page)).toContainText('Is it plugged in?');
  // The staff's first reply is the first response.
  await expect(details).toContainText('1 minute after it was raised');
  await expect(conversation(page)).toContainText(
    'Changed the status from To do to Waiting for the company.',
  );
  // It waits already, so there's nothing more to wait for.
  await expect(page.getByRole('button', { name: 'Send and wait for the company' })).toHaveCount(0);
  await signOut(page);

  // The company answers, which puts it back in progress.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await expect(main(page).getByText('Waiting for your reply', { exact: true })).toBeVisible();
  const staffReply = conversation(page)
    .getByRole('listitem')
    .filter({ hasText: 'Is it plugged in?' });
  // The staff are shown by name, with the name the company knows them by.
  await expect(staffReply).toContainText(SUPPORT_STAFF.name);
  await expect(staffReply).toContainText(STAFF_NAME);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Yes, it is. Floor 3.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(main(page).getByText('In progress', { exact: true })).toBeVisible();
  await expect(conversation(page)).toContainText(
    'Changed the status from Waiting for your reply to In progress.',
  );

  // Done, then open again, which the request says.
  await page.getByRole('button', { name: 'Mark as done' }).click();
  await expect(toasts(page)).toContainText('Request marked as done.');
  await expect(main(page).getByText('Done', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as done' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  // The button that had focus is gone: focus is on its card's heading, not lost.
  await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeFocused();

  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(toasts(page)).toContainText('Request reopened.');
  await expect(main(page).getByText('Open', { exact: true })).toBeVisible();
  await expect(main(page).getByText('Reopened', { exact: true })).toBeVisible();
  await expect(conversation(page)).toContainText('Reopened this request.');

  // Cancelling asks first, with a way out that doesn't say "Cancel".
  await page.getByRole('button', { name: 'Cancel request' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Cancel this request?' });
  await expect(dialog.getByRole('button', { name: 'Keep request' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep request' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(main(page).getByText('Open', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel request' }).click();
  await dialog.getByRole('button', { name: 'Cancel request' }).click();
  await expect(toasts(page)).toContainText('Request cancelled.');
  await expect(main(page).getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(main(page).getByText('Reopened', { exact: true })).toHaveCount(0);
  await expect(conversation(page)).toContainText('Cancelled this request.');
  // A reply to a cancelled request leaves it cancelled.
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Thanks anyway.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(main(page).getByText('Cancelled', { exact: true })).toBeVisible();
});

test('the staff edit a request’s details, and the company never sees its priority', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'Help',
  });

  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await expect(detail(page, 'Priority')).toHaveText('Normal');
  await expect(detail(page, 'Type')).toHaveText('Bug');
  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit this request’s details' });
  await dialog.getByRole('textbox', { name: 'Title' }).fill('The website shows an error page');
  await dialog.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'Hotfix' }).click();
  // A new type brings its own priority, which the staff can still change.
  await expect(dialog.getByRole('combobox', { name: 'Priority' })).toHaveText('High');
  await dialog.getByRole('button', { name: 'Save details' }).click();
  await expect(toasts(page)).toContainText('Details saved.');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeFocused();

  await expect(
    page.getByRole('heading', { level: 1, name: 'The website shows an error page' }),
  ).toBeVisible();
  await expect(detail(page, 'Type')).toHaveText('Hotfix');
  await expect(detail(page, 'Priority')).toHaveText('High');
  await expect(conversation(page)).toContainText(
    'Changed the title from “Help” to “The website shows an error page”.',
  );
  await expect(conversation(page)).toContainText('Changed the type from Bug to Hotfix.');
  await expect(conversation(page)).toContainText('Changed the priority from Normal to High.');
  await signOut(page);

  // Someone at the company sees the new title and type, and nothing about a priority.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'The website shows an error page' }),
  ).toBeVisible();
  await expect(conversation(page)).toContainText('Changed the type from Bug to Hotfix.');
  await expect(main(page).getByText(/priority/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveCount(0);
});

test('the staff assign a request, find it as theirs, and the company sees who works on it', async ({
  page,
}) => {
  const title = `Assign this ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });
  /**
   * The Assigned to detail of the request on the page.
   *
   * @returns Its value.
   */
  const assigned = () => detail(page, 'Assigned to');

  // One click puts the staff member on it; the button goes, so focus moves to the card.
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await expect(assigned()).toContainText('Not assigned yet');
  await assigned().getByRole('button', { name: 'Assign to me' }).click();
  await expect(toasts(page)).toContainText('You’re assigned to this request.');
  await expect(assigned().getByRole('listitem')).toHaveCount(1);
  await expect(assigned()).toContainText(SUPPORT_STAFF.name);
  await expect(assigned().getByRole('button', { name: 'Assign to me' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeFocused();
  await expect(conversation(page)).toContainText('Assigned themselves to this request.');

  // The dialog adds a colleague: everyone who works on requests, the viewer first and ticked.
  await assigned().getByRole('button', { name: 'Change assignees' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change who’s assigned' });
  await expect(dialog.getByRole('checkbox').first()).toHaveAccessibleName(
    `${SUPPORT_STAFF.name} (you)`,
  );
  await expect(dialog.getByRole('checkbox', { name: `${SUPPORT_STAFF.name} (you)` })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: FINANCE_STAFF.name })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: PLATFORM_MANAGER.name }).check();
  await dialog.getByRole('button', { name: 'Save assignees' }).click();
  await expect(toasts(page)).toContainText('Assignees saved.');
  await expect(dialog).toHaveCount(0);
  await expect(assigned().getByRole('button', { name: 'Change assignees' })).toBeFocused();
  await expect(assigned().getByRole('listitem')).toHaveCount(2);
  await expect(conversation(page)).toContainText(
    `Assigned ${PLATFORM_MANAGER.name} to this request.`,
  );
  // The colleague hears of it by email; taking a request yourself emails nobody.
  const assignedEmail = await waitForEmailAbout(PLATFORM_MANAGER.email, title);
  expect(assignedEmail.text).toContain(`${SUPPORT_STAFF.name} assigned this request to you.`);
  expect(await emailsAbout(SUPPORT_STAFF.email, title)).toHaveLength(0);

  // The list's assignee filter finds it as theirs, and the dashboard leads there too.
  await page.goto('/requests');
  await main(page)
    .getByRole('button', { name: /^Assignee/ })
    .click();
  await page.getByRole('menuitemradio', { name: 'Me', exact: true }).click();
  await expect(page).toHaveURL(/assignee=me/);
  const row = requestRows(page).filter({ hasText: title });
  await expect(row).toContainText(SUPPORT_STAFF.name);
  await expect(row).toContainText(PLATFORM_MANAGER.name);
  await page.goto('/dashboard');
  await main(page)
    .getByRole('link', { name: /^Assigned to you/ })
    .click();
  await expect(page).toHaveURL('/requests?assignee=me');
  await expect(requestRows(page).filter({ hasText: title })).toHaveCount(1);

  // Stepping off it leaves the colleague on it.
  await page.goto(`/requests/${number}`);
  await assigned().getByRole('button', { name: 'Change assignees' }).click();
  await dialog.getByRole('checkbox', { name: `${SUPPORT_STAFF.name} (you)` }).uncheck();
  await dialog.getByRole('button', { name: 'Save assignees' }).click();
  await expect(toasts(page)).toContainText('Assignees saved.');
  await expect(conversation(page)).toContainText('Removed themselves from this request.');
  await expect(assigned().getByRole('listitem')).toHaveCount(1);
  await expect(assigned().getByRole('button', { name: 'Assign to me' })).toBeVisible();
  await signOut(page);

  // Someone at the company sees who works on it, and how that came to be, and changes nothing.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await expect(assigned()).toContainText(PLATFORM_MANAGER.name);
  await expect(assigned()).not.toContainText(SUPPORT_STAFF.name);
  await expect(conversation(page)).toContainText('Assigned themselves to this request.');
  await expect(conversation(page)).toContainText(
    `Assigned ${PLATFORM_MANAGER.name} to this request.`,
  );
  await expect(assigned().getByRole('button')).toHaveCount(0);
});

test('people subscribe to a request, and the staff change who else follows it', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: `Follow this ${randomUUID().slice(0, 8)}`,
  });
  /**
   * The Subscribers detail of the request on the page.
   *
   * @returns Its value.
   */
  const subscribers = () => detail(page, 'Subscribers');
  /**
   * The subscribers' avatars: a button named by how many there are, which opens their names.
   *
   * @param count - How many subscribers the reader should see.
   * @returns The button.
   */
  const avatars = (count: number) =>
    subscribers().getByRole('button', {
      name: `Show the ${count} subscriber${count === 1 ? '' : 's'}`,
    });
  /** The panel with the subscribers' names, while it's open. */
  const names = page.getByRole('dialog', { name: 'Subscribers' });

  // A Watcher, who can't reply, follows it all the same; whoever raised it does already.
  await signIn(page, CLIENT_WATCHER);
  await page.goto(`/requests/${number}`);
  await expect(avatars(1)).toBeVisible();
  // Avatars only: the names are behind them.
  await expect(subscribers()).not.toContainText(REQUESTS_CLIENT.name);
  await subscribers().getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(toasts(page)).toContainText('You’re subscribed to this request.');
  // The button stays where it is and says what it does now, so focus stays on it.
  const unsubscribe = subscribers().getByRole('button', { name: 'Unsubscribe' });
  await expect(unsubscribe).toBeFocused();
  await avatars(2).click();
  await expect(names.getByRole('listitem')).toHaveCount(2);
  await expect(names.getByRole('listitem').filter({ hasText: CLIENT_WATCHER.name })).toContainText(
    'You',
  );
  await page.keyboard.press('Escape');
  await expect(names).toHaveCount(0);
  await expect(avatars(2)).toBeFocused();
  await unsubscribe.click();
  await expect(toasts(page)).toContainText('You’re no longer subscribed to this request.');
  await expect(avatars(1)).toBeVisible();
  await subscribers().getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(avatars(2)).toBeVisible();
  // Other people's subscriptions aren't theirs to change.
  await expect(subscribers().getByRole('button', { name: 'Change subscribers' })).toHaveCount(0);
  await signOut(page);

  // The staff who work on requests see everyone who follows it, and change who does: anyone at
  // the company, and anyone on the staff.
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await expect(avatars(2)).toBeVisible();
  await subscribers().getByRole('button', { name: 'Change subscribers' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change who’s subscribed' });
  const people = dialog.getByRole('group', { name: `People at ${COMPANY_NAME}` });
  const staff = dialog.getByRole('group', { name: 'Staff' });
  await expect(
    people.getByRole('checkbox', { name: REQUESTS_CLIENT.name, exact: true }),
  ).toBeChecked();
  await expect(
    staff.getByRole('checkbox', { name: `${SUPPORT_STAFF.name} (you)`, exact: true }),
  ).not.toBeChecked();
  await people.getByRole('checkbox', { name: CLIENT_WATCHER.name, exact: true }).uncheck();
  await staff.getByRole('checkbox', { name: FINANCE_STAFF.name, exact: true }).check();
  await dialog.getByRole('button', { name: 'Save subscribers' }).click();
  await expect(toasts(page)).toContainText('Subscribers saved.');
  await expect(dialog).toHaveCount(0);
  await expect(subscribers().getByRole('button', { name: 'Change subscribers' })).toBeFocused();
  await avatars(2).click();
  await expect(names.getByRole('listitem').filter({ hasText: CLIENT_WATCHER.name })).toHaveCount(0);
  // By name, for the staff with a link to the person's page; nothing labels who is on the staff.
  await expect(names.getByRole('link', { name: FINANCE_STAFF.name })).toBeVisible();
  await expect(names).not.toContainText(STAFF_NAME);
  await page.keyboard.press('Escape');
  // Following is no work on the request: its history says nothing about it.
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('No replies yet.');

  // A reply subscribes its writer.
  await page.getByRole('textbox', { name: 'Your reply' }).fill('We’re looking into it.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(avatars(3)).toBeVisible();
  await expect(subscribers().getByRole('button', { name: 'Unsubscribe' })).toBeVisible();
  await signOut(page);

  // Someone at the company sees who of their company follows it, never which staff members do.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await avatars(1).click();
  await expect(names.getByRole('listitem')).toHaveCount(1);
  await expect(names.getByRole('listitem')).toContainText(REQUESTS_CLIENT.name);
  await expect(names.getByRole('listitem')).toContainText('You');
  await expect(names).not.toContainText(FINANCE_STAFF.name);
  await page.keyboard.press('Escape');
  await expect(main(page)).not.toContainText(FINANCE_STAFF.name);
  await expect(subscribers().getByRole('button', { name: 'Unsubscribe' })).toBeVisible();
  await expect(subscribers().getByRole('button', { name: 'Change subscribers' })).toHaveCount(0);
});

test('a reply and the status it sets reach the other side’s inbox as one email', async ({
  page,
}) => {
  // A title of the test's own, which the email's subject holds.
  const title = `Email about this ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });

  // The staff ask something and wait for the answer; whoever raised it follows the request.
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Is it **plugged in**?');
  await page.getByRole('button', { name: 'Send and wait for the company' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');

  const email = await waitForEmailAbout(REQUESTS_CLIENT.email, title);
  expect(email.subject).toMatch(new RegExp(`^[A-Z]+-${number}: ${title}$`));
  // One email with both: the reply in full and formatted, and the status in the reader's words.
  expect(email.text).toContain(`${SUPPORT_STAFF.name} replied:`);
  expect(email.html).toContain('<strong>plugged in</strong>');
  expect(email.text).toContain(`${SUPPORT_STAFF.name} changed the status from Open to Waiting`);
  expect(email.text).toContain('Waiting for your reply');
  expect(await emailsAbout(REQUESTS_CLIENT.email, title)).toHaveLength(1);
  // Whoever wrote it isn't told about it.
  expect(await emailsAbout(SUPPORT_STAFF.email, title)).toHaveLength(0);

  // The email's link signs in the one it was sent to and opens the request (decision 0036).
  await signOut(page);
  await clickLinkInEmail(page, linkIn(email));
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // Their answer goes to the staff member, who replied and so follows it too.
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Yes, and the light is on.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const answer = await waitForEmailAbout(SUPPORT_STAFF.email, title);
  expect(answer.text).toContain(`${REQUESTS_CLIENT.name} replied:`);
  expect(answer.text).toContain('Yes, and the light is on.');
  expect(answer.text).toContain('from Waiting for the company to In progress');
});

test('an internal note reaches the staff on the request by email, and no one at the company', async ({
  page,
}) => {
  const title = `Note by email ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });

  // A staff Admin replies, and so follows the request.
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Looking into it.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await signOut(page);

  // A colleague writes a note for the staff.
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page
    .getByRole('tablist', { name: 'Write' })
    .getByRole('tab', { name: 'Internal note' })
    .click();
  const note = await markdownEditor(page, 'Your note');
  await note.click();
  await page.keyboard.type('The toner is empty.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(toasts(page)).toContainText('Note added.');

  const email = await waitForEmailAbout(PLATFORM_ADMIN.email, title);
  expect(email.text).toContain(`${SUPPORT_STAFF.name} wrote an internal note:`);
  expect(email.text).toContain('The toner is empty.');
  expect(email.text).toContain('Internal note: only the staff see this.');
  // The client follows the request too, and hears of the reply, never of the note.
  const toClient = await emailsAbout(REQUESTS_CLIENT.email, title);
  expect(toClient.length).toBeGreaterThan(0);
  toClient.forEach((sent) => {
    expect(sent.text).not.toContain('toner');
    expect(sent.text).not.toContain('internal note');
  });
});

test('the staff send a solution, and the client approves it on the request', async ({ page }) => {
  const title = `Solution to approve ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
    status: 'in_progress',
  });

  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Fixed: the toner was empty.');
  await page.getByRole('button', { name: 'Send as solution' }).click();
  await expect(toasts(page)).toContainText('Solution sent.');
  await expect(detail(page, 'Status')).toContainText('Waiting for approval');
  await expect(conversation(page)).toContainText('Proposed a solution.');
  // It's sent: the button goes until the company has answered.
  await expect(page.getByRole('button', { name: 'Send as solution' })).toHaveCount(0);
  await signOut(page);

  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await expect(detail(page, 'Status')).toHaveText('Waiting for your approval');
  const notice = page.getByRole('region', { name: 'The staff proposed a solution' });
  await expect(notice).toBeVisible();
  // They approve rather than mark it as done.
  await expect(page.getByRole('button', { name: 'Mark as done' })).toHaveCount(0);
  await notice.getByRole('button', { name: 'Approve' }).click();
  await expect(toasts(page)).toContainText('You approved the solution.');
  await expect(detail(page, 'Status')).toHaveText('Done');
  await expect(conversation(page)).toContainText('Approved the solution.');
  await expect(notice).toHaveCount(0);
});

test('the client denies a solution and says what’s still wrong, which goes back to the staff', async ({
  page,
}) => {
  const title = `Solution to deny ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
    status: 'in_progress',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Fixed, I think.');
  await page.getByRole('button', { name: 'Send as solution' }).click();
  await expect(toasts(page)).toContainText('Solution sent.');
  await signOut(page);

  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await page
    .getByRole('region', { name: 'The staff proposed a solution' })
    .getByRole('button', { name: 'Deny' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Doesn’t it solve your request?' });
  const reason = await markdownEditor(page, 'What’s still wrong?');
  await reason.click();
  await page.keyboard.type('It still prints blank pages.');
  await dialog.getByRole('button', { name: 'Deny solution' }).click();
  await expect(toasts(page)).toContainText('You didn’t approve the solution.');
  await expect(dialog).toHaveCount(0);
  await expect(detail(page, 'Status')).toHaveText('In progress');
  await expect(conversation(page)).toContainText('It still prints blank pages.');
  await expect(conversation(page)).toContainText('Didn’t approve the solution.');
});

test('the email’s Approve button answers on a click, and a mail scanner only gets a page with a button', async ({
  page,
  request: scanner,
}) => {
  const title = `Solution by email ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
    status: 'in_progress',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Fixed: a new toner is in.');
  await page.getByRole('button', { name: 'Send as solution' }).click();
  await expect(toasts(page)).toContainText('Solution sent.');
  await signOut(page);

  const email = await waitForEmailAbout(REQUESTS_CLIENT.email, title);
  expect(email.text).toContain('Does this solve your request?');
  const approve = defined(
    email.text.match(/https?:\/\/\S+\/answer\/[^\s/]+\/approve/)?.[0],
    'the Approve link',
  );

  // A scanner fetches the link without a person's click: it gets a page with a button, and nothing changes.
  const scanned = await scanner.get(approve);
  expect(scanned.url()).toMatch(/\/answer\/[^/]+\?answer=approve$/);
  expect(await scanned.text()).toContain('Approve the solution for');

  // The client clicks it in their mail app: it answers straight away, without signing in.
  await page.setContent(`<a href="${approve}">Approve</a>`);
  await page.getByRole('link', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: 'You approved the solution' })).toBeVisible();
  // The link worked once: opening it again only says what it did.
  await page.goto(approve.replace(/\/approve$/, ''));
  await expect(page.getByRole('heading', { name: 'You approved the solution' })).toBeVisible();

  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await expect(detail(page, 'Status')).toHaveText('Done');
  await expect(conversation(page)).toContainText('Approved the solution.');
});

test('an email’s link signs its reader in and opens the request at the reply it tells of', async ({
  page,
}) => {
  const title = `Long conversation ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
    status: 'in_progress',
    earlierReplies: 15,
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('The reply the email links to.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await signOut(page);

  // The reader's own link that signs them in, naming the reply and with its anchor (decision 0036).
  const link = linkIn(await waitForEmailAbout(REQUESTS_CLIENT.email, title));
  expect(link).toMatch(
    /\/api\/auth\/request-link\/sign-in\?token=[\w-]+&entry=([0-9a-f-]{36})#entry-\1$/,
  );
  const anchor = link.split('#')[1];
  const entry = page.locator(`#${anchor}`);
  const atReply = new RegExp(`/requests/${number}\\?entry=[0-9a-f-]{36}#${anchor}$`);

  // Signed out, a click signs them in and lands on the reply: the link passes the entry on, and
  // the anchor survives the redirect.
  await clickLinkInEmail(page, link);
  await expect(page).toHaveURL(atReply);
  await expect(entry).toContainText('The reply the email links to.');
  await expect(entry).toBeInViewport();
  await expect(entry).toBeFocused();

  // Signed in, a click on it again lands there straight away.
  await page.goto('/dashboard');
  await clickLinkInEmail(page, link);
  await expect(entry).toBeInViewport();
  await expect(entry).toBeFocused();

  // A browser that doesn't say a person clicked (an app's own browser) gets the confirmation page
  // first; its Continue still lands on the reply.
  await signOut(page);
  await page.goto(link.replace('/api/auth/request-link/sign-in', '/auth/request-link'));
  await page.getByRole('button', { name: /^Continue to / }).click();
  await expect(page).toHaveURL(atReply);
  await expect(entry).toBeInViewport();
  await expect(entry).toBeFocused();
});

test('turning emails about requests off stops them, and turning them on brings them back', async ({
  page,
}) => {
  const title = `Quiet please ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });
  // A Watcher of this test's own, so nothing else they do is changed by it.
  const watcher = { email: freshAddress('quiet-watcher'), password: 'quiet-watcher-password' };
  await page.goto(
    await storeInvitation({
      companyId: await findCompanyId(COMPANY_SLUG),
      email: watcher.email,
      role: 'watcher',
    }),
  );
  await createAccountFromInvitation(page, 'Quiet Watcher Tester', watcher.password);
  /**
   * Sends a reply to the request as the staff, and waits until whoever raised it has the email
   * about it: by then the emails about it have gone out.
   *
   * @param body - The reply.
   */
  const replyAsStaff = async (body: string) => {
    await signIn(page, SUPPORT_STAFF);
    await page.goto(`/requests/${number}`);
    await page.getByRole('textbox', { name: 'Your reply' }).fill(body);
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(toasts(page)).toContainText('Reply sent.');
    await expect
      .poll(async () =>
        (await emailsAbout(REQUESTS_CLIENT.email, title)).some((email) =>
          email.text.includes(body),
        ),
      )
      .toBe(true);
    await signOut(page);
  };

  // They follow the request, then turn emails about requests off in their account.
  await page.goto(`/requests/${number}`);
  await detail(page, 'Subscribers').getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(toasts(page)).toContainText('You’re subscribed to this request.');
  await page.goto('/account');
  const card = page.getByRole('region', { name: 'Emails about requests' });
  await expect(card).toContainText('On');
  await card.getByRole('button', { name: 'Turn off' }).click();
  await expect(toasts(page)).toContainText('Emails about requests turned off.');
  await expect(card).toContainText('Off');
  // The button says what it does now, and keeps the keyboard's place.
  await expect(card.getByRole('button', { name: 'Turn on' })).toBeFocused();
  await signOut(page);

  // A reply reaches the others, and not them.
  await replyAsStaff('Is it plugged in?');
  expect(await emailsAbout(watcher.email, title)).toHaveLength(0);

  // Turned on again, the next reply reaches them, without the one they missed.
  await signIn(page, watcher);
  await page.goto('/account');
  await card.getByRole('button', { name: 'Turn on' }).click();
  await expect(toasts(page)).toContainText('Emails about requests turned on.');
  await signOut(page);
  await replyAsStaff('Does the light come on?');
  const email = await waitForEmailAbout(watcher.email, title);
  expect(email.text).toContain('Does the light come on?');
  expect(email.text).not.toContain('Is it plugged in?');
  // Its footer says where they turned it off.
  expect(email.text).toContain('/account#request-emails');
});

test('a company’s Admin subscribes a colleague, and is offered nobody from the staff', async ({
  page,
}) => {
  // A company of this test's own, with a colleague who follows and an Admin.
  const slug = `adiutor-tests-following-${randomUUID().slice(0, 8)}`;
  const companyId = await createCompany({ name: 'Adiutor Tests Following', slug });
  const colleagueEmail = freshAddress('following-watcher');
  await page.goto(await storeInvitation({ companyId, email: colleagueEmail, role: 'watcher' }));
  await createAccountFromInvitation(page, 'Follows Along Tester', 'follows-along-password');
  await signOut(page);
  const adminEmail = freshAddress('following-admin');
  await page.goto(await storeInvitation({ companyId, email: adminEmail, role: 'admin' }));
  await createAccountFromInvitation(
    page,
    'Subscribing Admin Tester',
    'subscribing-admin-password',
    '/account/security?setup=required',
  );
  await setUpAuthenticator(page, 'subscribing-admin-password');
  const number = await storeRequest({
    companySlug: slug,
    raisedBy: adminEmail,
    title: 'A request for a colleague to follow',
  });

  await page.goto(`/requests/${number}`);
  const subscribers = detail(page, 'Subscribers');
  await expect(subscribers.getByRole('button', { name: 'Show the 1 subscriber' })).toBeVisible();
  await subscribers.getByRole('button', { name: 'Change subscribers' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change who’s subscribed' });
  // Their colleagues, themselves among them, and nobody else.
  await expect(dialog.getByRole('group')).toHaveCount(1);
  const people = dialog.getByRole('group', { name: 'People at Adiutor Tests Following' });
  await expect(people.getByRole('checkbox')).toHaveCount(2);
  await expect(
    people.getByRole('checkbox', { name: 'Subscribing Admin Tester (you)' }),
  ).toBeChecked();
  await expect(dialog).toContainText('Everyone at your company sees who’s subscribed.');
  // People are named by a key there: a colleague's user ID never reaches the browser.
  expect(await page.content()).not.toContain(await findUserId(colleagueEmail));
  await people.getByRole('checkbox', { name: 'Follows Along Tester' }).check();
  await dialog.getByRole('button', { name: 'Save subscribers' }).click();
  await expect(toasts(page)).toContainText('Subscribers saved.');
  await subscribers.getByRole('button', { name: 'Show the 2 subscribers' }).click();
  await expect(page.getByRole('dialog', { name: 'Subscribers' })).toContainText(
    'Follows Along Tester',
  );
});

test('the staff reach a person’s page from a request, and nobody at the company does', async ({
  page,
}) => {
  const path = `/requests/${SEEDED_REQUESTS.waiting.number}`;
  const clientId = await findUserId(REQUESTS_CLIENT.email);
  const staffId = await findUserId(SUPPORT_STAFF.email);

  // For the staff, who have a page for every user, each name is a link to it.
  await signIn(page, SUPPORT_STAFF);
  await page.goto(path);
  await expect(
    conversation(page).getByRole('link', { name: SUPPORT_STAFF.name }).first(),
  ).toHaveAttribute('href', `/admin/users/${staffId}`);
  await detail(page, 'Raised by').getByRole('link', { name: REQUESTS_CLIENT.name }).click();
  await expect(page).toHaveURL(`/admin/users/${clientId}`);
  await expect(page.getByRole('heading', { level: 1, name: REQUESTS_CLIENT.name })).toBeVisible();
  await signOut(page);

  // Someone at the company reads the same names, as text: nothing says more about who they are.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(path);
  await expect(conversation(page)).toContainText(SUPPORT_STAFF.name);
  await expect(detail(page, 'Raised by')).toContainText(REQUESTS_CLIENT.name);
  await expect(main(page).getByRole('link', { name: SUPPORT_STAFF.name })).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: REQUESTS_CLIENT.name })).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(staffId);
  expect(html).not.toContain(clientId);
});

test('a reply formats itself while it’s typed, and reads the same once it’s sent', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A reply typed as Markdown',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');

  // Markdown turns into formatting as it's typed.
  await editor.click();
  await page.keyboard.type('# The plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type(
    'It is **urgent**, see `config.yml` and https://adiutor.test/plan first.',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.type('- order the part');
  await page.keyboard.press('Enter');
  await page.keyboard.type('fit it');
  await expect(editor.getByRole('heading', { level: 1, name: 'The plan' })).toBeVisible();
  await expect(editor.locator('strong')).toHaveText('urgent');
  await expect(editor.locator('code')).toHaveText('config.yml');
  await expect(editor.getByRole('link', { name: 'https://adiutor.test/plan' })).toBeVisible();
  await expect(editor.getByRole('listitem')).toHaveText(['order the part', 'fit it']);
  // The marks themselves are gone from the text.
  await expect(editor).not.toContainText('**');
  await expect(editor).not.toContainText('#');

  // Sent, it reads the same, and the editor is empty for the next reply.
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const thread = page.getByRole('region', { name: 'Conversation' });
  await expect(thread.getByRole('heading', { level: 3, name: 'The plan' })).toBeVisible();
  await expect(thread.locator('strong')).toHaveText('urgent');
  await expect(thread.locator('code')).toHaveText('config.yml');
  await expect(
    thread.getByRole('link', { name: /^https:\/\/adiutor\.test\/plan/ }),
  ).toHaveAttribute('target', '_blank');
  await expect(thread.locator('ul > li')).toHaveText(['order the part', 'fit it']);
  await expect(await markdownEditor(page, 'Your reply')).toHaveText('');
});

test('the editor is tall enough to write in, and can be dragged taller', async ({ page }) => {
  await signIn(page, REQUESTS_CLIENT);

  // A reply starts at eight lines, a description at fourteen; both grow with their text.
  await page.goto(`/requests/${SEEDED_REQUESTS.open.number}`);
  const reply = await markdownEditor(page, 'Your reply');
  expect((await reply.boundingBox())?.height).toBeGreaterThanOrEqual(200);

  // Dragging the corner at the bottom makes it taller, as a plain text field's does.
  await reply.scrollIntoViewIfNeeded();
  const { x = 0, y = 0, width = 0, height = 0 } = (await reply.boundingBox()) ?? {};
  await page.mouse.move(x + width - 2, y + height - 2);
  await page.mouse.down();
  await page.mouse.move(x + width - 2, y + height + 120, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await reply.boundingBox())?.height)
    .toBeGreaterThanOrEqual(height + 100);
  // A click in the room that made lands in the text.
  const taller = (await reply.boundingBox())?.height ?? 0;
  await reply.click({ position: { x: width / 2, y: taller - 20 } });
  await expect(reply).toBeFocused();

  await page.goto('/requests/new');
  const description = await markdownEditor(page, 'Description');
  expect((await description.boundingBox())?.height).toBeGreaterThanOrEqual(340);
});

test('a request uses the room of a wide screen, with its details still beside it', async ({
  page,
}) => {
  await signIn(page, REQUESTS_CLIENT);
  /**
   * Whether the page scrolls sideways.
   *
   * @returns Whether it's wider than the window.
   */
  const scrollsSideways = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

  // At 1280px, where the app's content stops growing, a request is as wide as every page.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/requests/${SEEDED_REQUESTS.open.number}`);
  const reply = await markdownEditor(page, 'Your reply');
  const narrow = (await reply.boundingBox())?.width ?? 0;
  expect(narrow).toBeLessThan(600);
  expect(await scrollsSideways()).toBe(false);

  // On a wider screen it grows, and the reply's editor with it; the details stay beside it.
  await page.setViewportSize({ width: 1512, height: 982 });
  await expect.poll(async () => (await reply.boundingBox())?.width).toBeGreaterThanOrEqual(760);
  const thread = await page.getByRole('region', { name: 'Conversation' }).boundingBox();
  const details = await page.getByRole('region', { name: 'Details' }).boundingBox();
  expect(details?.x).toBeGreaterThan((thread?.x ?? 0) + (thread?.width ?? 0));
  expect(await scrollsSideways()).toBe(false);

  // It stops growing at 1280px of content, however wide the screen.
  await page.setViewportSize({ width: 2560, height: 1300 });
  await expect.poll(async () => (await reply.boundingBox())?.width).toBeLessThanOrEqual(810);
  expect(await scrollsSideways()).toBe(false);

  // A new request's form is wide enough to write a description in.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/requests/new');
  const description = await markdownEditor(page, 'Description');
  expect((await description.boundingBox())?.width).toBeGreaterThanOrEqual(800);
  expect(await scrollsSideways()).toBe(false);
});

test('the toolbar formats a reply for someone who doesn’t type Markdown', async ({ page }) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A reply formatted with the buttons',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  const bold = toolbar.getByRole('button', { name: 'Bold' });

  // Bold: switched on, typed in, switched off. The button says whether it's on.
  await editor.click();
  await page.keyboard.type('This is ');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect(editor).toBeFocused();
  await page.keyboard.type('important');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await expect(editor).toBeFocused();
  await page.keyboard.type(' today.');
  await expect(editor.locator('strong')).toHaveText('important');

  // A heading from the menu, for the line the cursor is on.
  await page.keyboard.press('Enter');
  await page.keyboard.type('What we did');
  await toolbar.getByRole('button', { name: 'Heading' }).click();
  await page.getByRole('menuitemradio', { name: 'Subheading' }).click();
  await expect(editor.getByRole('heading', { level: 2, name: 'What we did' })).toBeVisible();
  // The text has the focus again, not the menu's button.
  await expect(editor).toBeFocused();

  // A list, and a link through its dialog, which takes only a whole web address.
  await page.keyboard.press('Enter');
  await toolbar.getByRole('button', { name: 'Bullet list' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('Read ');
  await toolbar.getByRole('button', { name: 'Link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link' });
  await dialog.getByRole('textbox', { name: 'Web address' }).fill('adiutor.test/manual');
  await dialog.getByRole('button', { name: 'Save link' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter a whole web address');
  await dialog.getByRole('textbox', { name: 'Web address' }).fill('https://adiutor.test/manual');
  await dialog.getByRole('button', { name: 'Save link' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor.getByRole('link', { name: 'https://adiutor.test/manual' })).toBeVisible();
  await expect(editor).toBeFocused();

  // Sent, the reply reads as it was written.
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const thread = page.getByRole('region', { name: 'Conversation' });
  await expect(thread.locator('strong')).toHaveText('important');
  await expect(thread.getByRole('heading', { level: 3, name: 'What we did' })).toBeVisible();
  await expect(thread.locator('ul > li')).toContainText('Read');
  await expect(
    thread.getByRole('link', { name: /^https:\/\/adiutor\.test\/manual/ }),
  ).toHaveAttribute('href', 'https://adiutor.test/manual');
});

test('a block of code is coloured while it’s written, in the language picked for it', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A reply with a block of code',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });

  // Three backticks and a language start a block; its languages load now, and colour it.
  await editor.click();
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const answer = 42;');
  await expect(editor.locator('figcaption')).toHaveText('TypeScript');
  await expect(editor.locator('pre [class*="hljs-keyword"]')).toHaveText('const');

  // Another language from the toolbar's menu, which is there while the cursor is in the block.
  await toolbar.getByRole('button', { name: 'Language: TypeScript' }).click();
  await page.getByRole('menuitemradio', { name: 'JavaScript' }).click();
  await expect(editor.locator('figcaption')).toHaveText('JavaScript');
  await expect(editor).toBeFocused();
  await expect(editor.locator('pre [class*="hljs-keyword"]')).toHaveText('const');

  // Sent, it's a block in that language.
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const sent = page
    .getByRole('region', { name: 'Conversation' })
    .getByRole('group', { name: 'JavaScript code' });
  await expect(sent).toHaveText('const answer = 42;');
  await expect(sent.locator('[class*="hljs-keyword"]')).toHaveText('const');
});

test('Markdown that is pasted is formatted, and a tag stays the text it is', async ({ page }) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A reply pasted as Markdown',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');

  // Plain text on the clipboard, as copied from a text file.
  await editor.click();
  await editor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData(
      'text/plain',
      'Steps to **reproduce**:\n\n1. Open the page\n2. Press <b>Save</b>\n\n```bash\nnpm test\n```',
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  });
  await expect(editor.locator('strong')).toHaveText('reproduce');
  await expect(editor.getByRole('listitem')).toHaveCount(2);
  await expect(editor.locator('pre')).toHaveText('npm test');
  // The tag is text, here and once it's sent.
  await expect(editor.getByRole('listitem').nth(1)).toHaveText('Press <b>Save</b>');

  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const thread = page.getByRole('region', { name: 'Conversation' });
  await expect(thread.locator('strong')).toHaveText('reproduce');
  // (The conversation is a list itself, so the numbered list is the one inside it.)
  await expect(thread.locator('ol ol > li').nth(1)).toHaveText('Press <b>Save</b>');
  await expect(thread.locator('b')).toHaveCount(0);
  await expect(thread.getByRole('group', { name: 'Bash code' })).toHaveText('npm test');
});

test('a mention that is copied and pasted is still a mention once it is sent', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A mention copied and pasted',
  });
  const thread = page.getByRole('region', { name: 'Conversation' });
  const clientId = await findUserId(REQUESTS_CLIENT.email);
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');

  // A reply that mentions someone picked from the list at "@".
  await editor.click();
  await page.keyboard.type('**Please** check, @e2e requests cl');
  await page.getByRole('listbox', { name: 'People to mention' }).getByRole('option').click();
  await page.keyboard.type('thanks.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');

  // Copied from the conversation, as someone selects it, and pasted: the mention is one.
  const posted = thread.locator('ol > li').filter({ hasText: 'Please check' });
  await posted
    .locator('[data-mention]')
    .locator('xpath=../..')
    .evaluate((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
  await page.keyboard.press('ControlOrMeta+C');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(editor.locator('[data-mention]')).toHaveText(`@${REQUESTS_CLIENT.name}`);

  // Copied in the editor and pasted twice in its place: still a mention, and not in bold (the
  // look a mention has where it's read isn't formatting).
  await expect(editor.locator('strong [data-mention]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+V');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(editor.locator('[data-mention]')).toHaveText([
    `@${REQUESTS_CLIENT.name}`,
    `@${REQUESTS_CLIENT.name}`,
  ]);

  // Sent, both mention the person, with the formatting around them, and no address in the text
  // leads to the person's page.
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const sent = thread.locator('ol > li').last();
  const mentions = sent.getByRole('link', { name: `@${REQUESTS_CLIENT.name}` });
  await expect(mentions).toHaveCount(2);
  await expect(mentions.first()).toHaveAttribute('href', `/admin/users/${clientId}`);
  await expect(mentions.last()).toHaveAttribute('href', `/admin/users/${clientId}`);
  await expect(sent.locator('strong')).toHaveText(['Please', 'Please']);
  await expect(sent.locator('a[href^="http"]')).toHaveCount(0);
  await expect(sent).toContainText(`Please check, @${REQUESTS_CLIENT.name} thanks.`);
});

test('people are mentioned from the list at @, by what the writer may know', async ({ page }) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A reply that mentions someone',
  });
  const list = page.getByRole('listbox', { name: 'People to mention' });
  const thread = page.getByRole('region', { name: 'Conversation' });

  // The staff can mention the staff, with their label, and everyone at the company.
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');
  await editor.click();
  await page.keyboard.type('Thanks @e2e fin');
  await expect(list.getByRole('option')).toHaveText([`${FINANCE_STAFF.name}${STAFF_NAME}`]);
  // Escape closes the list, and what was typed stays the text it is.
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(editor).toBeFocused();
  // A name is narrowed as it's typed, spaces and all, and Enter picks it.
  await page.keyboard.type(' and @e2e requests cl');
  await expect(list.getByRole('option')).toHaveText([REQUESTS_CLIENT.name]);
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(editor.locator('[data-mention]')).toHaveText(`@${REQUESTS_CLIENT.name}`);
  await expect(editor).toBeFocused();
  await page.keyboard.type('can you check?');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');

  // For the staff the mention links to the user's page. A name that was only typed is text.
  await expect(thread).toContainText(`Thanks @e2e fin and @${REQUESTS_CLIENT.name} can you check?`);
  const clientId = await findUserId(REQUESTS_CLIENT.email);
  await expect(thread.getByRole('link', { name: `@${REQUESTS_CLIENT.name}` })).toHaveAttribute(
    'href',
    `/admin/users/${clientId}`,
  );
  await expect(thread.locator('[data-mention]')).toHaveCount(1);

  // The person mentioned sees their mention set apart, and no link.
  await signOut(page);
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  const mention = thread.locator('[data-mention]');
  await expect(mention).toHaveText(`@${REQUESTS_CLIENT.name}`);
  await expect(mention).toHaveClass(/border-highlight/);
  await expect(thread.getByRole('link', { name: `@${REQUESTS_CLIENT.name}` })).toHaveCount(0);

  // Someone at the company can mention the staff member who replied, but nobody else on the
  // staff: what's typed is nobody's name to them, and the list closes by itself.
  const reply = await markdownEditor(page, 'Your reply');
  await reply.click();
  await page.keyboard.type('@e2e fin');
  await expect(list).toBeHidden();
  await page.keyboard.type(' @e2e sup');
  await expect(list.getByRole('option')).toHaveText([`${SUPPORT_STAFF.name}${STAFF_NAME}`]);
  await list.getByRole('option').click();
  await expect(reply).toBeFocused();
  // And a colleague, who the request hasn't shown them yet.
  await page.keyboard.type('and @e2e wat');
  await expect(list.getByRole('option')).toHaveText([CLIENT_WATCHER.name]);
  await page.keyboard.press('Enter');
  await expect(reply.locator('[data-mention]')).toHaveText([
    `@${SUPPORT_STAFF.name}`,
    `@${CLIENT_WATCHER.name}`,
  ]);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(thread.locator('[data-mention]')).toHaveText([
    `@${REQUESTS_CLIENT.name}`,
    `@${SUPPORT_STAFF.name}`,
    `@${CLIENT_WATCHER.name}`,
  ]);
  // Nothing in the page names anyone by an ID.
  expect(await page.content()).not.toContain(clientId);
});

test('a new request’s description mentions a colleague', async ({ page }) => {
  await signIn(page, REQUESTS_CLIENT);
  await page.goto('/requests/new');
  await page.getByRole('textbox', { name: 'Title' }).fill('A request that mentions a colleague');
  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: /^Bug/ }).click();
  const description = await markdownEditor(page, 'Description');
  const list = page.getByRole('listbox', { name: 'People to mention' });
  await description.click();
  await page.keyboard.type('@e2e wat');
  await expect(list.getByRole('option')).toHaveText([CLIENT_WATCHER.name]);
  await page.keyboard.press('Enter');
  await expect(description.locator('[data-mention]')).toHaveText(`@${CLIENT_WATCHER.name}`);
  // Their colleagues only: a request that isn't raised yet shows them nobody on the staff, so
  // a staff member's name is nobody's to them, and the list closes by itself.
  await page.keyboard.type('saw it first, not @e2e sup');
  await expect(list).toBeHidden();
  await page.getByRole('button', { name: 'Raise request' }).click();

  await expect(page).toHaveURL(/\/requests\/\d+$/);
  const asked = page.getByRole('region', { name: 'Description' });
  await expect(asked.locator('[data-mention]')).toHaveText(`@${CLIENT_WATCHER.name}`);
  await expect(asked).toContainText(`@${CLIENT_WATCHER.name} saw it first, not @e2e sup`);
});

test('a reply is written on in the large view, and sent from the page', async ({ page }) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A reply written in the large view',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');
  await editor.click();
  await page.keyboard.type('Started on the page.');
  // Found by its element: behind an open dialog the page has no roles to find it by.
  const send = page.locator('button', { hasText: 'Send reply' });
  const sendAt = await send.boundingBox();

  // The same editor, in a dialog named like the field, with the cursor where it was.
  await page.getByRole('button', { name: 'Large view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your reply' });
  const large = dialog.getByRole('textbox', { name: 'Your reply' });
  await expect(large).toBeFocused();
  await expect(large).toHaveText('Started on the page.');
  // It has room: more than half of the window's height, where the field has eight lines.
  const size = await large.boundingBox();
  expect(size?.height).toBeGreaterThan((page.viewportSize()?.height ?? 0) / 2);
  // The page behind it didn't move.
  expect((await send.boundingBox())?.y).toBe(sendAt?.y);

  // What was typed on the page can be undone and brought back here.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(large).not.toHaveText('Started on the page.');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(large).toHaveText('Started on the page.');

  // Writing goes on, with the dialog's own toolbar.
  await page.keyboard.type(' Finished in the **large** view. ');
  await expect(large.locator('strong')).toHaveText('large');
  // The button gives the text the focus back, a moment after it's pressed.
  await dialog.getByRole('button', { name: 'Bold' }).click();
  await expect(large).toBeFocused();
  await page.keyboard.type('Really.');
  await expect(large.locator('strong').last()).toHaveText('Really.');

  // Back on the page with Escape: the field holds everything, and the text has the focus.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const back = await markdownEditor(page, 'Your reply');
  await expect(back).toBeFocused();
  await expect(back).toHaveText('Started on the page. Finished in the large view. Really.');
  await expect(page.getByRole('button', { name: 'Large view' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await send.click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const thread = page.getByRole('region', { name: 'Conversation' });
  await expect(thread).toContainText('Started on the page. Finished in the large view. Really.');
  await expect(thread.locator('strong')).toHaveText(['large', 'Really.']);
});

test('a reply that isn’t sent yet is still there after leaving the page and coming back', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A reply left half written',
  });
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const editor = await markdownEditor(page, 'Your reply');
  await editor.click();
  await page.keyboard.type('Half a **reply**');
  await expect(editor.locator('strong')).toHaveText('reply');

  // The page is kept while the user is elsewhere, and its editor starts again from the text.
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.goBack();
  await expect(page).toHaveURL(`/requests/${number}`);
  const kept = await markdownEditor(page, 'Your reply');
  await expect(kept).toHaveText('Half a reply');
  await expect(kept.locator('strong')).toHaveText('reply');

  // And it's sent as it was written.
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(page.getByRole('region', { name: 'Conversation' }).locator('strong')).toHaveText(
    'reply',
  );
});

test('the editor isn’t sent with the page: it loads once the page is there', async ({ page }) => {
  await signIn(page, REQUESTS_CLIENT);

  // The scripts the page itself asks for, as its HTML names them.
  const response = await page.request.get('/requests/new');
  const html = await response.text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)[^"]*"/g)].flatMap(([, src]) =>
    src ? [src] : [],
  );
  expect(scripts.length).toBeGreaterThan(5);
  const sources = await Promise.all(
    scripts.map(async (src) => (await page.request.get(src)).text()),
  );
  // None of them holds the editor: its library hides the selection with a class of this name.
  expect(sources.filter((source) => source.includes('ProseMirror-hideselection'))).toEqual([]);

  // The page then loads it by itself, and the plain field becomes the editor.
  const loaded: string[] = [];
  page.on('response', (loadedResponse) => {
    if (loadedResponse.url().endsWith('.js')) {
      loaded.push(loadedResponse.url());
    }
  });
  await page.goto('/requests/new');
  await markdownEditor(page, 'Description');
  const later = loaded.filter((url) => !scripts.some((src) => url.endsWith(src)));
  expect(later.length).toBeGreaterThan(0);
});

test('a request written in Markdown is shown formatted, and nothing in it loads', async ({
  page,
}) => {
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${SEEDED_REQUESTS.formatted.number}`);

  // What was asked: a heading below the card's own, a list, a table, and an address that opens
  // in a new tab.
  const description = page.getByRole('region', { name: 'Description' });
  await expect(description.getByRole('heading', { level: 3, name: 'What we need' })).toBeVisible();
  await expect(description.locator('strong', { hasText: '1 July' })).toBeVisible();
  await expect(description.getByRole('listitem')).toHaveCount(3);
  const table = description.getByRole('group', { name: 'Table' });
  await expect(table.getByRole('columnheader', { name: 'When' })).toBeVisible();
  await expect(table.getByRole('cell', { name: '24 June' })).toBeVisible();
  const address = description.getByRole('link', {
    name: /^https:\/\/adiutor\.test\/docs\/intranet/,
  });
  await expect(address).toHaveAttribute('target', '_blank');
  await expect(address).toHaveAttribute('rel', 'noopener noreferrer nofollow');

  // The staff's reply: code under the name of its language, coloured; a quotation; things to do.
  const thread = page.getByRole('region', { name: 'Conversation' });
  const config = thread.getByRole('group', { name: 'Nginx config code' });
  await expect(config).toContainText('server_name intranet.adiutor.test;');
  await expect(config.locator('[class*="hljs-"]').first()).toBeVisible();
  await expect(thread.getByRole('group', { name: 'Bash code' })).toContainText('curl --include');
  await expect(thread.locator('blockquote')).toContainText('pointed at it');
  await expect(thread.locator('ul > li').filter({ hasText: 'Your test' })).toHaveText(
    'To do: Your test',
  );
  await expect(thread.getByRole('checkbox')).toHaveCount(0);

  // An image is a link to it, and is never loaded.
  const image = thread.getByRole('link', { name: /^The new home page \(image\)/ });
  await expect(image).toHaveAttribute('href', 'https://adiutor.test/intranet-home.png');
  await expect(page.locator('img[src*="intranet-home"]')).toHaveCount(0);

  // The company's answer mentions the staff member it thanks: by name, set apart from the text,
  // and no link for someone at the company. It's not the reader who is mentioned.
  const mention = thread.locator('[data-mention]');
  await expect(mention).toHaveText(`@${SUPPORT_STAFF.name}`);
  await expect(mention).not.toHaveClass(/border-highlight/);
  await expect(thread.getByRole('link', { name: `@${SUPPORT_STAFF.name}` })).toHaveCount(0);
  await expect(thread).toContainText(`Thanks, @${SUPPORT_STAFF.name}!`);

  // The company's answer: its footnote and the reference lead to each other.
  await thread.getByRole('link', { name: '1', exact: true }).click();
  await expect(page).toHaveURL(/-fn-1$/);
  await thread.getByRole('link', { name: 'Back to reference 1' }).click();
  await expect(page).toHaveURL(/-fnref-1$/);
});

test('a block of code is copied below a note of where it’s from', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${SEEDED_REQUESTS.formatted.number}`);
  const thread = page.getByRole('region', { name: 'Conversation' });
  /**
   * The block of code in a language, with its caption and its button.
   *
   * @param name - The name of the code, e.g. "Bash code".
   * @returns The block.
   */
  const block = (name: string) =>
    thread.getByRole('figure').filter({ has: page.getByRole('group', { name }) });
  /**
   * Reads what was copied.
   *
   * @returns The clipboard's text.
   */
  const copied = () => page.evaluate(() => navigator.clipboard.readText());
  // The request's address and who wrote the reply, on the day they did, as two lines of comment.
  const address = `${E2E_BASE_URL}/requests/${SEEDED_REQUESTS.formatted.number}`;
  const note = new RegExp(
    `^# Source: ${address}\\n# Written by ${SUPPORT_STAFF.name} on [A-Z][a-z]{2} \\d{1,2}, \\d{4}\\n`,
  );

  // A command: the note, then the command as it was written, without a line break after it.
  const command = block('Bash code');
  await command.getByRole('button', { name: 'Copy code' }).click();
  await expect(command.getByRole('button', { name: 'Copied' })).toBeVisible();
  const [source, written, ...code] = (await copied()).split('\n');
  expect(`${source}\n${written}\n`).toMatch(note);
  expect(code).toEqual([
    'curl --include --header "Accept: application/json" --header "X-Checked-By: Adiutor Tests" --max-time 10 https://intranet.adiutor.test/health',
  ]);
  // The button says so for a moment, then offers to copy again.
  await expect(command.getByRole('button', { name: 'Copy code' })).toBeVisible();

  // A configuration of several lines keeps its lines, its spaces and its empty line.
  await block('Nginx config code').getByRole('button', { name: 'Copy code' }).click();
  await expect.poll(copied).toMatch(note);
  expect((await copied()).replace(note, '')).toBe(
    [
      'server {',
      '  listen 443 ssl;',
      '  server_name intranet.adiutor.test;',
      '',
      '  location / {',
      '    proxy_pass http://127.0.0.1:3000;',
      '  }',
      '}',
    ].join('\n'),
  );
});

test('someone at a company edits the description, and the staff read what it said before', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'The printer on floor 2 jams',
    description: 'It jams on every page.',
  });

  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  const description = page.getByRole('region', { name: 'Description' });
  const editDescription = description.getByRole('button', { name: 'Edit description' });
  await expect(description.getByText('Edited', { exact: true })).toHaveCount(0);

  // The text opens in the editor in its place, with the cursor at its end.
  await editDescription.click();
  const editor = description.getByRole('textbox', { name: 'Description' });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toHaveText('It jams on every page.');
  await expect(editor).toBeFocused();
  await page.keyboard.type(' Only when it prints on **both** sides.');
  await description.getByRole('button', { name: 'Save' }).click();
  await expect(toasts(page)).toContainText('Changes saved.');
  await expect(editor).toHaveCount(0);
  await expect(description).toContainText(
    'It jams on every page. Only when it prints on both sides.',
  );
  await expect(description.locator('strong', { hasText: 'both' })).toBeVisible();
  await expect(editDescription).toBeFocused();
  // Everyone sees that it was edited, and when; what it said before is for the staff.
  const edited = description.getByText('Edited', { exact: true });
  await expect(edited).toHaveAttribute('title', /^Edited /);
  await expect(description.getByRole('button', { name: 'Edited' })).toHaveCount(0);

  // Saving it as it is changes nothing.
  await editDescription.click();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  await description.getByRole('button', { name: 'Save' }).click();
  await expect(toasts(page)).toContainText('Nothing changed.');
  await signOut(page);

  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  const versionsButton = description.getByRole('button', { name: 'Edited' });
  await versionsButton.click();
  const versions = page.getByRole('dialog', { name: 'Earlier versions' });
  await expect(versions).toContainText(`${REQUESTS_CLIENT.name} changed this on`);
  await expect(versions).toContainText('It jams on every page.');
  await expect(versions).not.toContainText('both sides');
  await page.keyboard.press('Escape');
  await expect(versions).toHaveCount(0);
  await expect(versionsButton).toBeFocused();
});

test('the staff edit their own reply, which the company sees was edited', async ({ page }) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'The VPN drops every hour',
  });

  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Restart the router.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const reply = conversation(page).getByRole('listitem').filter({ hasText: 'Restart the router' });

  await reply.getByRole('button', { name: 'Edit reply' }).click();
  const editor = reply.getByRole('textbox', { name: 'Reply', exact: true });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  // Cancel puts the text back as it was.
  await page.keyboard.type(' Not saved.');
  await reply.getByRole('button', { name: 'Cancel' }).click();
  await expect(reply).not.toContainText('Not saved.');
  await expect(reply.getByRole('button', { name: 'Edit reply' })).toBeFocused();

  await reply.getByRole('button', { name: 'Edit reply' }).click();
  // The editor takes over from the plain field it starts as, then takes the focus: only then
  // is it typed in.
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Restart the router.');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Restart the router, then the laptop.');
  await reply.getByRole('button', { name: 'Save' }).click();
  await expect(toasts(page)).toContainText('Changes saved.');
  await expect(reply).toContainText('Restart the router, then the laptop.');
  await reply.getByRole('button', { name: 'Edited' }).click();
  const versions = page.getByRole('dialog', { name: 'Earlier versions' });
  await expect(versions).toContainText(`${SUPPORT_STAFF.name} changed this on`);
  await expect(versions).toContainText('Restart the router.');
  // Closed with its button: the toast about the save is a layer too, and would take an Escape.
  await versions.getByRole('button', { name: 'Close' }).click();
  await expect(versions).toHaveCount(0);
  await signOut(page);

  // The company sees that it was edited, and can't edit it: it isn't theirs.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await expect(reply).toContainText('Restart the router, then the laptop.');
  await expect(reply.getByText('Edited', { exact: true })).toBeVisible();
  await expect(reply.getByRole('button', { name: 'Edited' })).toHaveCount(0);
  await expect(reply.getByRole('button', { name: 'Edit reply' })).toHaveCount(0);
  // The description is theirs to edit.
  await expect(
    page.getByRole('region', { name: 'Description' }).getByRole('button', {
      name: 'Edit description',
    }),
  ).toBeVisible();
});

test('nothing is edited once a request is done', async ({ page }) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A printer that works again',
    status: 'done',
  });

  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  // A reply can still be sent, but neither it nor the description can be edited.
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Thanks, it works now.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(conversation(page)).toContainText('Thanks, it works now.');
  await expect(main(page).getByRole('button', { name: /^Edit (description|reply)$/ })).toHaveCount(
    0,
  );
});

test('the staff write an internal note, which Finance reads and the company never sees', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'The label printer prints blank labels',
  });
  const list = page.getByRole('listbox', { name: 'People to mention' });
  const write = page.getByRole('tablist', { name: 'Write' });

  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await expect(write.getByRole('tab', { name: 'Reply' })).toHaveAttribute('aria-selected', 'true');
  // A reply that's started stays on its own tab.
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Not sent yet.');
  await write.getByRole('tab', { name: 'Internal note' }).click();
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeHidden();
  await expect(main(page).getByText('Only the staff see internal notes.')).toBeVisible();

  // A note can mention someone at the company.
  const note = await markdownEditor(page, 'Your note');
  await note.click();
  await page.keyboard.type('Probably the toner. @e2e requests cl');
  await expect(list.getByRole('option')).toHaveText([REQUESTS_CLIENT.name]);
  await page.keyboard.press('Enter');
  await page.keyboard.type('asked twice.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(toasts(page)).toContainText('Note added.');
  await expect(note).toHaveText('');
  const entry = conversation(page).getByRole('listitem').filter({ hasText: 'Probably the toner.' });
  await expect(entry).toContainText('Internal note');
  await expect(entry).toContainText(`@${REQUESTS_CLIENT.name} asked twice.`);
  // Nothing the company sees changed.
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveText('Open');
  await expect(detail(page, 'First response')).toHaveText('Not yet');
  await write.getByRole('tab', { name: 'Reply' }).click();
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toHaveText('Not sent yet.');

  // Its author edits it, like a reply.
  await entry.getByRole('button', { name: 'Edit note' }).click();
  const editor = entry.getByRole('textbox', { name: 'Note', exact: true });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toBeFocused();
  await page.keyboard.type(' Toner ordered.');
  await entry.getByRole('button', { name: 'Save' }).click();
  await expect(toasts(page)).toContainText('Changes saved.');
  await expect(entry).toContainText('asked twice. Toner ordered.');
  await signOut(page);

  // Finance reads it, and writes none.
  await signIn(page, FINANCE_STAFF);
  await page.goto(`/requests/${number}`);
  await expect(entry).toContainText('Internal note');
  await expect(entry).toContainText('Toner ordered.');
  await expect(write).toHaveCount(0);
  await signOut(page);

  // The company never sees it, also not the person it mentions.
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'The label printer prints blank labels' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('No replies yet.');
  await expect(main(page)).not.toContainText('toner');
  await expect(main(page).getByText('Internal note')).toHaveCount(0);
  await expect(write).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeVisible();
});

test('a Watcher follows a request without taking part', async ({ page }) => {
  await signIn(page, CLIENT_WATCHER);
  await page.goto(`/requests/${SEEDED_REQUESTS.waiting.number}`);

  await expect(
    page.getByRole('heading', { level: 1, name: SEEDED_REQUESTS.waiting.title }),
  ).toBeVisible();
  // It waits for their company, not for them.
  await expect(main(page).getByText('Waiting for your company', { exact: true })).toBeVisible();
  await expect(conversation(page)).toContainText('It’s for the summer schedule, from 1 July.');
  // The link someone wrote opens in a new tab, and says so to a screen reader.
  const link = conversation(page).getByRole('link', { name: /adiutor\.test\/preview/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(link).toContainText('(opens in a new tab)');
  await expect(main(page).getByText(/priority/i)).toHaveCount(0);
  await expectReadOnly(page);
});

test('Finance reads a request with its priority, and changes nothing', async ({ page }) => {
  await signIn(page, FINANCE_STAFF);
  await page.goto(`/requests/${SEEDED_REQUESTS.waiting.number}`);

  await expect(detail(page, 'Status')).toHaveText('Waiting for the company');
  await expect(detail(page, 'Priority')).toHaveText('High');
  await expect(conversation(page)).toContainText('Changed the priority from Normal to High.');
  await expect(detail(page, 'Company').getByRole('link', { name: COMPANY_NAME })).toBeVisible();
  await expect(detail(page, 'Raised by')).toContainText(REQUESTS_CLIENT.name);
  // The staff's first reply came long after it was raised.
  await expect(detail(page, 'First response')).toContainText('after it was raised');
  await expectReadOnly(page);
  // Following it is theirs; other people's subscriptions are for the staff who work on requests.
  const subscribers = detail(page, 'Subscribers');
  await expect(subscribers.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible();
  await expect(subscribers.getByRole('button', { name: 'Change subscribers' })).toHaveCount(0);
});

test('a deactivated company’s request can only be read, also by the staff', async ({ page }) => {
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${SEEDED_REQUESTS.closedCompany.number}`);

  await expect(
    page.getByRole('heading', { level: 1, name: SEEDED_REQUESTS.closedCompany.title }),
  ).toBeVisible();
  await expect(
    detail(page, 'Company').getByRole('link', { name: CLOSED_COMPANY_NAME }),
  ).toBeVisible();
  await expect(detail(page, 'Status')).toHaveText('In progress');
  await expect(
    main(page).getByText('This company is deactivated, so its requests can only be read.'),
  ).toBeVisible();
  await expectReadOnly(page);
  // Nobody subscribes there either.
  await expect(
    main(page).getByRole('button', { name: /^(Subscribe|Unsubscribe|Change subscribers)$/ }),
  ).toHaveCount(0);
});

test('a staff member signed in as a user replies for them, and only that user and Admins are told', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A request to answer for the client',
  });
  const reply = 'Sent on your behalf.';
  await signIn(page, PLATFORM_ADMIN);
  await signInAsUser(page, REQUESTS_CLIENT.name);

  await page.goto(`/requests/${number}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'A request to answer for the client' }),
  ).toBeVisible();
  // They see what the user sees, without a priority, and can do the user's request work.
  await expect(main(page).getByText(/priority/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as done' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Edit description' })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Your reply' }).fill(reply);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  const sent = conversation(page).getByRole('listitem').filter({ hasText: reply });
  // The reply is the client's, and says to them who sent it.
  await expect(sent).toContainText(REQUESTS_CLIENT.name);
  await expect(sent).toContainText(`${PLATFORM_ADMIN.name} did this while signed in as you`);
  // Subscriptions too, which leave no history: the audit log records them instead.
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible();

  // Back in their own account, the Admin (who sees the audit log) reads whom it was for.
  await page
    .getByRole('region', { name: 'Signed in as someone else' })
    .getByRole('button', { name: 'Back to my account' })
    .click();
  await expect(page.getByRole('region', { name: 'Signed in as someone else' })).toHaveCount(0);
  await page.goto(`/requests/${number}`);
  await expect(sent).toContainText(
    `${PLATFORM_ADMIN.name} did this while signed in as ${REQUESTS_CLIENT.name}`,
  );
  await page.goto('/admin/logs');
  await expect(
    page.getByText('Changed a request’s subscribers while signed in as a user').first(),
  ).toBeVisible();
  await signOut(page);

  // A colleague at the company reads it as the client's own reply.
  await signIn(page, CLIENT_WATCHER);
  await page.goto(`/requests/${number}`);
  await expect(sent).toContainText(REQUESTS_CLIENT.name);
  await expect(sent).not.toContainText('signed in as');
});

test('the activity shows the groups and order its reader chose, on every visit', async ({
  page,
}) => {
  // The view is saved with the account: start from everything, oldest first, also on a retry.
  await resetActivityView(ACTIVITY_SUPPORT.email);
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'Activity read the way its reader chose',
  });
  await storeEntries(number, [
    { kind: 'comment', by: REQUESTS_CLIENT.email, side: 'company', text: 'The first reply.' },
    { kind: 'note', by: SUPPORT_STAFF.email, side: 'staff', text: 'A note for the staff.' },
    { kind: 'status', by: SUPPORT_STAFF.email, side: 'staff', from: 'open', to: 'in_progress' },
    { kind: 'comment', by: SUPPORT_STAFF.email, side: 'staff', text: 'The last reply.' },
  ]);
  const card = page.getByRole('region', { name: 'Conversation' });
  const entries = conversation(page).getByRole('listitem');
  const menu = page.getByRole('menu');

  await signIn(page, ACTIVITY_SUPPORT);
  await page.goto(`/requests/${number}`);
  await expect(entries).toHaveCount(4);

  // Only the replies, which for the staff bring the internal notes.
  await card.getByRole('button', { name: 'Show: Everything' }).click();
  await menu.getByRole('menuitemcheckbox', { name: 'Status changes' }).click();
  await menu.getByRole('menuitemcheckbox', { name: 'Other changes' }).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Internal notes' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(card.getByRole('button', { name: 'Show: Replies' })).toBeFocused();
  await expect(entries).toHaveCount(3);
  await expect(card).not.toContainText('Changed the status');
  await expect(card).toContainText('A note for the staff.');

  // Without Replies, the notes stay: only the notes.
  await card.getByRole('button', { name: 'Show: Replies' }).click();
  await menu.getByRole('menuitemcheckbox', { name: 'Replies' }).click();
  await page.keyboard.press('Escape');
  await expect(card.getByRole('button', { name: 'Show: Internal notes' })).toBeVisible();
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText('A note for the staff.');

  // Only the status changes.
  await card.getByRole('button', { name: 'Show: Internal notes' }).click();
  await menu.getByRole('menuitemcheckbox', { name: 'Status changes' }).click();
  await menu.getByRole('menuitemcheckbox', { name: 'Internal notes' }).click();
  await page.keyboard.press('Escape');
  await expect(card.getByRole('button', { name: 'Show: Status changes' })).toBeVisible();
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText('Changed the status from Open to In progress.');

  // The newest first, everything again: the reply form comes before the activity, and a reply
  // that's half written moves along with it.
  const reply = await markdownEditor(page, 'Your reply');
  await reply.click();
  await page.keyboard.type('Half written.');
  await card.getByRole('button', { name: 'Oldest first' }).click();
  await menu.getByRole('menuitemradio', { name: 'Newest first' }).click();
  await expect(card.getByRole('button', { name: 'Newest first' })).toBeFocused();
  await expect(reply).toHaveText('Half written.');
  await card.getByRole('button', { name: 'Show: Status changes' }).click();
  await menu.getByRole('menuitemcheckbox', { name: 'Everything' }).click();
  await page.keyboard.press('Escape');
  await expect(entries).toHaveCount(4);
  await expect(entries.first()).toContainText('The last reply.');
  await expect(entries.last()).toContainText('The first reply.');
  const tabs = card.getByRole('tablist');
  const tabsBox = await tabs.boundingBox();
  const firstBox = await entries.first().boundingBox();
  expect(tabsBox?.y ?? Infinity).toBeLessThan(firstBox?.y ?? 0);

  // Saved with the account: it reads the same way on the next visit.
  await page.reload();
  await expect(card.getByRole('button', { name: 'Newest first' })).toBeVisible();
  await expect(entries.first()).toContainText('The last reply.');

  // Someone at the company is never offered the internal notes; the menu is only opened.
  await signOut(page);
  await signIn(page, REQUESTS_CLIENT);
  await page.goto(`/requests/${number}`);
  await card.getByRole('button', { name: 'Show: Everything' }).click();
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText([
    'Everything',
    'Replies',
    'Status changes',
    'Other changes',
  ]);
  await page.keyboard.press('Escape');
  await expect(entries).toHaveCount(3);
});

/**
 * A lane of the board on the page.
 *
 * @param page - The browser page, on the board.
 * @param name - The lane's name, in the reader's words.
 * @returns The lane's section.
 */
const boardLane = (page: Page, name: string) =>
  page.getByRole('region', { name: new RegExp(`^${name}, \\d+ requests?$`) });

/**
 * Opens the board narrowed down to a test's own requests by their title.
 *
 * @param page - The browser page, signed in.
 * @param search - What their titles have in common.
 */
async function openBoard(page: Page, search: string): Promise<void> {
  await page.goto(`/requests/board?q=${encodeURIComponent(search)}`);
}

test('the staff switch the requests to a board and move a card with its Move menu', async ({
  page,
}) => {
  const title = `A card for the board ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });

  await signIn(page, SUPPORT_STAFF);
  // The List | Board toggle keeps the search.
  await page.goto(`/requests?q=${encodeURIComponent(title)}`);
  await page
    .getByRole('navigation', { name: 'View requests as' })
    .getByRole('link', { name: 'Board' })
    .click();
  await expect(page).toHaveURL(
    `/requests/board?q=${encodeURIComponent(title).replace(/%20/g, '+')}`,
  );
  await expect(page).toHaveTitle('Request board · Adiutor');
  await expect(page.getByRole('link', { name: 'Board', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const open = boardLane(page, 'Open');
  await expect(open.getByRole('link', { name: title })).toBeVisible();
  // The staff's lanes and the card's number; the company has no lane of its own words here.
  await expect(boardLane(page, 'Waiting for the company')).toBeVisible();
  await expect(open).toContainText(`AD-${number}`);

  await open.getByRole('button', { name: `Move AD-${number}` }).click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'To do',
    'In progress',
    'Waiting for the company',
    'Done',
    'Cancelled',
  ]);
  await page.getByRole('menuitem', { name: 'In progress' }).click();
  await expect(toasts(page)).toContainText(`AD-${number} moved to In progress.`);
  await expect(boardLane(page, 'In progress').getByRole('link', { name: title })).toBeVisible();
  await expect(open.getByRole('link', { name: title })).toHaveCount(0);

  // The request's page agrees, and its history says who moved it.
  await boardLane(page, 'In progress').getByRole('link', { name: title }).click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveText('In progress');
  await expect(conversation(page)).toContainText('Changed the status from Open to In progress.');
});

test('moving a card on the board to Done or Cancelled asks first, also for a Client', async ({
  page,
}) => {
  const title = `A card to close ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });

  await signIn(page, REQUESTS_CLIENT);
  await openBoard(page, title);
  // A Client's lanes are worded for them.
  await expect(boardLane(page, 'Waiting for your reply')).toBeVisible();
  const move = boardLane(page, 'Open').getByRole('button', { name: `Move AD-${number}` });

  // Keeping it changes nothing.
  await move.click();
  await page.getByRole('menuitem', { name: 'Cancelled' }).click();
  const cancel = page.getByRole('alertdialog', { name: `Cancel AD-${number}?` });
  await expect(cancel).toContainText('It can be reopened later.');
  await cancel.getByRole('button', { name: 'Keep request' }).click();
  await expect(cancel).toBeHidden();
  await expect(move).toBeFocused();
  await expect(boardLane(page, 'Open').getByRole('link', { name: title })).toBeVisible();

  await move.click();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  const done = page.getByRole('alertdialog', { name: `Mark AD-${number} as done?` });
  await done.getByRole('button', { name: 'Mark as done' }).click();
  await expect(toasts(page)).toContainText(`AD-${number} moved to Done.`);
  const closed = boardLane(page, 'Done');
  await expect(closed.getByRole('link', { name: title })).toBeVisible();
  // Focus followed the card, whose menu now reopens it.
  const moved = closed.getByRole('button', { name: `Move AD-${number}` });
  await expect(moved).toBeFocused();
  await moved.click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Open']);
  await page.keyboard.press('Escape');
});

test('a move from a board that’s out of date is refused, and the board shows the card as it is', async ({
  page,
}) => {
  const title = `A card someone else moved ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });

  await signIn(page, SUPPORT_STAFF);
  await openBoard(page, title);
  await expect(boardLane(page, 'Open').getByRole('link', { name: title })).toBeVisible();
  // A colleague moves it to To do meanwhile.
  await setStoredRequestStatus(number, 'todo');

  await boardLane(page, 'Open')
    .getByRole('button', { name: `Move AD-${number}` })
    .click();
  await page.getByRole('menuitem', { name: 'In progress' }).click();
  await expect(main(page).getByRole('alert')).toContainText(
    'This request’s status changed in the meantime. Check it and try again.',
  );
  await expect(toasts(page)).toContainText('This request’s status changed in the meantime.');
  // Not overwritten: the board now shows it where the colleague put it.
  await expect(boardLane(page, 'To do').getByRole('link', { name: title })).toBeVisible();
  await expect(boardLane(page, 'In progress').getByRole('link', { name: title })).toHaveCount(0);
});

test('a lane of the board with more requests than it shows opens the list of them all', async ({
  page,
}) => {
  const prefix = `Closed for the board ${randomUUID().slice(0, 8)}`;
  // Six done requests: one more than the Done half of the Closed column shows.
  await Array.from({ length: 6 }, (_, index) => index).reduce(async (previous, index) => {
    await previous;
    await storeRequest({
      companySlug: COMPANY_SLUG,
      raisedBy: REQUESTS_CLIENT.email,
      title: `${prefix} ${index + 1}`,
      status: 'done',
    });
  }, Promise.resolve());

  await signIn(page, SUPPORT_STAFF);
  await openBoard(page, prefix);
  const done = boardLane(page, 'Done');
  await expect(done.getByRole('link', { name: new RegExp(`^${prefix}`) })).toHaveCount(5);
  await done.getByRole('link', { name: 'See all 6 requests in Done' }).click();

  await expect(page).toHaveURL(
    `/requests?only=done&q=${encodeURIComponent(prefix).replace(/%20/g, '+')}`,
  );
  await expect(main(page)).toContainText('Only requests with this status:');
  await expect(requestRows(page)).toHaveCount(6);
});

test('a card dragged on the board to a lane it may go to moves there', async ({ page }) => {
  const title = `A card to drag ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });

  await signIn(page, SUPPORT_STAFF);
  await openBoard(page, title);
  const card = boardLane(page, 'Open').getByRole('listitem').filter({ hasText: title });
  // The grip comes once the drag and drop has loaded.
  const grip = card.locator('[data-drag-handle]');
  await expect(grip).toBeVisible();
  await grip.dragTo(boardLane(page, 'In progress'));

  await expect(toasts(page)).toContainText(`AD-${number} moved to In progress.`);
  await expect(boardLane(page, 'In progress').getByRole('link', { name: title })).toBeVisible();
  await expect(boardLane(page, 'Open').getByRole('link', { name: title })).toHaveCount(0);
});

test('a card dragged on the board to a lane it can’t go to stays, and the board says why', async ({
  page,
}) => {
  const title = `A card that can’t go there ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title,
  });

  // A Client closes or cancels a request; the other lanes are the staff's.
  await signIn(page, REQUESTS_CLIENT);
  await openBoard(page, title);
  const card = boardLane(page, 'Open').getByRole('listitem').filter({ hasText: title });
  const grip = card.locator('[data-drag-handle]');
  await expect(grip).toBeVisible();
  await grip.dragTo(boardLane(page, 'To do'));

  await expect(main(page).getByRole('alert')).toContainText(
    `Only ${STAFF_NAME} can move AD-${number} to that lane.`,
  );
  await expect(toasts(page)).toContainText(`Only ${STAFF_NAME} can move AD-${number}`);
  // Nothing was sent: it's still open, on the board and on its page.
  await expect(boardLane(page, 'Open').getByRole('link', { name: title })).toBeVisible();
  await page.goto(`/requests/${number}`);
  await expect(detail(page, 'Status')).toHaveText('Open');
});

test.describe('the board’s Waiting and Closed columns, on a wide screen', () => {
  // Wide enough for all five columns side by side, so every half is on screen to drag to and
  // the row doesn't scroll during a drag.
  test.use({ viewport: { width: 1600, height: 1000 } });

  /**
   * Stores a request of the test's own and opens the board, signed in as
   * the staff, narrowed down to it.
   *
   * @param page - The browser page.
   * @param title - The request's title.
   * @returns The request's number and its card's grip.
   */
  async function boardWith(page: Page, title: string) {
    const number = await storeRequest({
      companySlug: COMPANY_SLUG,
      raisedBy: REQUESTS_CLIENT.email,
      title,
      status: 'in_progress',
    });
    await signIn(page, SUPPORT_STAFF);
    await openBoard(page, title);
    const grip = boardLane(page, 'In progress')
      .getByRole('listitem')
      .filter({ hasText: title })
      .locator('[data-drag-handle]');
    await expect(grip).toBeVisible();
    return { number, grip };
  }

  test('a card dragged to Closed’s upper half is marked as done, after its question', async ({
    page,
  }) => {
    const title = `A card to drag to Done ${randomUUID().slice(0, 8)}`;
    const { number, grip } = await boardWith(page, title);
    await expect(
      page.getByRole('region', { name: /^Closed, \d+ requests?$/ }).getByRole('heading', {
        level: 3,
      }),
    ).toHaveText([/^Done/, /^Cancelled/]);

    await grip.dragTo(boardLane(page, 'Done'));
    await page
      .getByRole('alertdialog', { name: `Mark AD-${number} as done?` })
      .getByRole('button', { name: 'Mark as done' })
      .click();

    await expect(toasts(page)).toContainText(`AD-${number} moved to Done.`);
    await expect(boardLane(page, 'Done').getByRole('link', { name: title })).toBeVisible();
  });

  test('a card dragged to Closed’s lower half is cancelled, after its question', async ({
    page,
  }) => {
    const title = `A card to drag to Cancelled ${randomUUID().slice(0, 8)}`;
    const { number, grip } = await boardWith(page, title);

    await grip.dragTo(boardLane(page, 'Cancelled'));
    await page
      .getByRole('alertdialog', { name: `Cancel AD-${number}?` })
      .getByRole('button', { name: 'Cancel request' })
      .click();

    await expect(toasts(page)).toContainText(`AD-${number} moved to Cancelled.`);
    await expect(boardLane(page, 'Cancelled').getByRole('link', { name: title })).toBeVisible();
  });

  test('a card dragged to Waiting’s upper half waits for the company', async ({ page }) => {
    const title = `A card to drag to Waiting ${randomUUID().slice(0, 8)}`;
    const { number, grip } = await boardWith(page, title);

    await grip.dragTo(boardLane(page, 'Waiting for the company'));

    await expect(toasts(page)).toContainText(`AD-${number} moved to Waiting for the company.`);
    await expect(
      boardLane(page, 'Waiting for the company').getByRole('link', { name: title }),
    ).toBeVisible();
  });

  test('a card dragged to Waiting’s lower half stays, since approval comes with a solution', async ({
    page,
  }) => {
    const title = `A card that can’t wait for approval ${randomUUID().slice(0, 8)}`;
    const { number, grip } = await boardWith(page, title);

    await grip.dragTo(boardLane(page, 'Waiting for approval'));

    await expect(main(page).getByRole('alert')).toContainText(
      `AD-${number} waits for approval only once a reply is sent as its solution.`,
    );
    await expect(boardLane(page, 'In progress').getByRole('link', { name: title })).toBeVisible();
    await expect(
      boardLane(page, 'Waiting for approval').getByRole('link', { name: title }),
    ).toHaveCount(0);
  });
});
