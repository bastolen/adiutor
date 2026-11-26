/**
 * @file End-to-end tests for attachments (decision 0044): the files of a
 * request's texts, shown under each text with a thumbnail for an image and
 * downloaded under their names, a note's files for the staff only. Each
 * test stores a request of its own and attaches files to it directly.
 */
import { storeAttachment, storeEntries, storeOwnRequest } from './support/db';
import { PLATFORM_ADMIN, REQUESTS_CLIENT } from './support/fixtures';
import { signedInOnce } from './support/stored-sign-in';
import { expect, test } from './support/test';

/** A one-pixel PNG, which a browser shows as a thumbnail. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
);

/**
 * A small text file.
 *
 * @param text - What it says.
 * @returns Its bytes.
 */
function textFile(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

const clientCookies = signedInOnce(REQUESTS_CLIENT);
const adminCookies = signedInOnce(PLATFORM_ADMIN);

/**
 * Stores a request of the test's own with a screenshot on its description,
 * a log on a reply and notes on an internal note.
 *
 * @param title - The request's title.
 * @returns Its number, and the note's file's ID.
 */
async function requestWithFiles(title: string): Promise<{ number: number; noteFile: string }> {
  const number = await storeOwnRequest({ title });
  await storeEntries(number, [
    { by: REQUESTS_CLIENT.email, side: 'company', kind: 'comment', text: 'The log is attached.' },
    { by: PLATFORM_ADMIN.email, side: 'staff', kind: 'note', text: 'Driver notes attached.' },
  ]);
  await storeAttachment(number, { name: 'error.png', contentType: 'image/png', bytes: PNG });
  await storeAttachment(number, {
    name: 'printer.log',
    contentType: 'text/plain',
    bytes: textFile('printer offline'),
    entryText: 'The log is attached.',
  });
  const noteFile = await storeAttachment(number, {
    name: 'driver notes.txt',
    contentType: 'text/plain',
    bytes: textFile('reinstall the driver'),
    entryText: 'Driver notes attached.',
  });
  return { number, noteFile };
}

test('a company reads the files of a request’s texts and downloads them, never a note’s', async ({
  page,
  context,
}) => {
  const { number, noteFile } = await requestWithFiles('Files a company reads');
  await context.addCookies(clientCookies());
  await page.goto(`/requests/${number}`);

  const description = page.getByRole('region', { name: 'Description' });
  await expect(description.getByRole('list', { name: '1 attachment' })).toBeVisible();
  // The screenshot shows as a thumbnail, loaded from Adiutor itself.
  await expect(description.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await expect(
    description.getByRole('link', { name: /^Download error\.png, \d+ bytes$/ }),
  ).toBeVisible();

  const conversation = page.getByRole('region', { name: 'Conversation' });
  const log = conversation.getByRole('link', { name: 'Download printer.log, 15 bytes' });
  await expect(log).toBeVisible();
  await expect(conversation.getByText('driver notes.txt')).toHaveCount(0);

  // A download under its name, which nothing keeps, sniffs or shows elsewhere.
  const download = page.waitForEvent('download');
  await log.click();
  expect((await download).suggestedFilename()).toBe('printer.log');
  const response = await page.request.get((await log.getAttribute('href')) ?? '');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe('printer offline');
  expect(response.headers()).toMatchObject({
    'content-disposition': 'attachment; filename="printer.log"; filename*=UTF-8\'\'printer.log',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; sandbox",
  });

  // The note's file is missing to the company, even by its address.
  expect((await page.request.get(`/attachments/${noteFile}`)).status()).toBe(404);
});

test('the staff read an internal note’s files too', async ({ page, context }) => {
  const { number, noteFile } = await requestWithFiles('Files the staff read');
  await context.addCookies(adminCookies());
  await page.goto(`/requests/${number}`);

  const conversation = page.getByRole('region', { name: 'Conversation' });
  await expect(
    conversation.getByRole('link', { name: 'Download driver notes.txt, 20 bytes' }),
  ).toBeVisible();
  const response = await page.request.get(`/attachments/${noteFile}`);
  expect(await response.text()).toBe('reinstall the driver');
});

test('someone signed out who opens a file is sent to sign in', async ({ page }) => {
  const { noteFile } = await requestWithFiles('A file signed out');
  await page.goto(`/attachments/${noteFile}`);
  await expect(page).toHaveURL(new RegExp(`/auth\\?callbackURL=%2Fattachments%2F${noteFile}`));
});
