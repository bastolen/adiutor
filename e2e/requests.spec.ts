/**
 * @file End-to-end tests for a request's page: its description, details and
 * conversation, the staff and a company working a request through (status,
 * replies, done, reopened, cancelled), the staff editing its details, and
 * who only reads: Watchers, Finance, everyone for a
 * deactivated company's request, and a staff member signed in as a user.
 * Each test that changes a request stores its own (`storeRequest`); the
 * seeded ones are only read.
 */
import type { Page } from '@playwright/test';

import { storeRequest } from './support/db';
import {
  CLIENT_WATCHER,
  CLOSED_COMPANY_NAME,
  COMPANY_NAME,
  COMPANY_SLUG,
  FINANCE_STAFF,
  PLATFORM_ADMIN,
  REQUESTS_CLIENT,
  SEEDED_REQUESTS,
  STAFF_NAME,
  SUPPORT_STAFF,
} from './support/fixtures';
import { signIn, signInAsUser, signOut, toasts } from './support/helpers';
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
