/**
 * @file End-to-end tests for requests: the list with its filters, search,
 * sorting and pages, and what it says without requests, raising a request
 * (someone at a company, and the staff
 * for a company), and a request's page: its description, details and
 * conversation, the staff and a company working a request through (status,
 * replies, done, reopened, cancelled), the staff editing its details, the
 * prefix numbers are shown with, and
 * who only reads: Watchers, Finance, everyone for a
 * deactivated company's request, and a staff member signed in as a user.
 * The staff reach a person's user page from their name; nobody at a company
 * does.
 * Each test that changes a request stores its own (`storeRequest`); the
 * seeded ones are only read.
 */
import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import {
  createCompany,
  findCompanyId,
  findUserId,
  setRequestPrefix,
  storeInvitation,
  storeRequest,
} from './support/db';
import {
  CLIENT_WATCHER,
  CLOSED_COMPANY_NAME,
  COMPANY_NAME,
  COMPANY_SLUG,
  FINANCE_STAFF,
  FIRST_PAGED_REQUEST_NUMBER,
  PAGED_REQUEST_COUNT,
  pagedRequestTitle,
  PAGING_COMPANY_NAME,
  PAGING_COMPANY_SLUG,
  PLATFORM_ADMIN,
  REQUESTS_CLIENT,
  SEEDED_REQUESTS,
  STAFF_NAME,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  createAccountFromInvitation,
  freshAddress,
  signIn,
  signInAsUser,
  signOut,
  toasts,
} from './support/helpers';
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
 * Checks that a request's page offers nothing to change it with.
 *
 * @param page - The browser page, on a request.
 */
async function expectReadOnly(page: Page) {
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveCount(0);
  await expect(
    main(page).getByRole('button', {
      name: /^(Send reply|Mark as done|Cancel request|Reopen|Edit details)$/,
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

  // What still needs something, the latest activity on top; nothing closed.
  const table = main(page).getByRole('table');
  await expect(table).toHaveAccessibleName(
    /^Active requests, sorted by Last activity, most recent first, page 1 of 2$/,
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

test('someone at a company sees its requests only, without priorities', async ({ page }) => {
  await signIn(page, REQUESTS_CLIENT);
  await page.goto('/requests?status=all');

  await expect(requestRows(page).filter({ hasText: SEEDED_REQUESTS.waiting.title })).toContainText(
    'Waiting for your reply',
  );
  await expect(main(page).getByText(SEEDED_REQUESTS.done.title)).toBeVisible();
  // Nothing of other companies, and no way to ask for it.
  await expect(main(page).getByText('Paged request')).toHaveCount(0);
  await expect(main(page).getByText(SEEDED_REQUESTS.closedCompany.title)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Company', exact: true })).toHaveCount(0);
  await page.goto(`/requests?status=all&company=${PAGING_COMPANY_SLUG}`);
  await expect(main(page).getByText('Paged request')).toHaveCount(0);
  await expect(main(page).getByText(SEEDED_REQUESTS.waiting.title)).toBeVisible();

  // No priority: no column, no filter, no sort, and asking for one changes nothing.
  await expect(main(page).getByText(/priority/i)).toHaveCount(0);
  await page.getByRole('button', { name: /^Sort\s*requests/ }).click();
  await expect(page.getByRole('menuitemradio', { name: /Priority/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/requests?status=all&priority=low&sort=priority');
  await expect(main(page).getByText(SEEDED_REQUESTS.waiting.title)).toBeVisible();
  await expect(main(page).getByRole('table')).toHaveAccessibleName(
    /^All requests, sorted by Last activity, most recent first$/,
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
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue('');
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

  // From a company's own list the company is chosen already.
  await page.goto(`/requests/new?company=${COMPANY_SLUG}`);
  await expect(page.getByRole('combobox', { name: 'Company' })).toHaveText(COMPANY_NAME);
  // A deactivated company's requests can only be read, so it isn't offered.
  await page.getByRole('combobox', { name: 'Company' }).click();
  await expect(page.getByRole('option', { name: CLOSED_COMPANY_NAME })).toHaveCount(0);
  // The chosen company stays chosen. Its name isn't picked from the list: other specs add
  // companies with the same name.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: 'Company' })).toHaveText(COMPANY_NAME);

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
  await page.goto('/requests');
  await expect(main(page).getByText(SEEDED_REQUESTS.waiting.title)).toBeVisible();
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
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toHaveValue('');
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

  // The company's answer: its footnote and the reference lead to each other.
  await thread.getByRole('link', { name: '1', exact: true }).click();
  await expect(page).toHaveURL(/-fn-1$/);
  await thread.getByRole('link', { name: 'Back to reference 1' }).click();
  await expect(page).toHaveURL(/-fnref-1$/);
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
});

test('nothing about a request can be changed while a staff member is signed in as a user', async ({
  page,
}) => {
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: REQUESTS_CLIENT.email,
    title: 'A request to look at',
  });
  await signIn(page, PLATFORM_ADMIN);
  await signInAsUser(page, REQUESTS_CLIENT.name);

  await page.goto(`/requests/${number}`);
  await expect(page.getByRole('heading', { level: 1, name: 'A request to look at' })).toBeVisible();
  // They see what the user sees, and every control is off.
  await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send reply' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Mark as done' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel request' })).toBeDisabled();
  await expect(main(page).getByText(/priority/i)).toHaveCount(0);
});
