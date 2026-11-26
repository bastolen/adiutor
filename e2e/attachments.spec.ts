/**
 * @file End-to-end tests for attachments (decisions 0044 and 0054): files
 * attached while writing (by the Attach button, a drop and a paste, checked
 * in the browser and uploaded at once) and sent with a reply, a note or a
 * new request; and the files of a request's texts, shown under each text
 * with a thumbnail for an image and downloaded under their names, a note's
 * files for the staff only, kept by the reader's browser and checked with
 * the server before each use. Each test stores or raises a request of its
 * own.
 */
import type { Locator, Page } from '@playwright/test';

import { storeAttachment, storeEntries, storeOwnRequest } from './support/db';
import { PLATFORM_ADMIN, REQUESTS_CLIENT } from './support/fixtures';
import { markdownEditor, toasts } from './support/helpers';
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

/**
 * Chooses files with the Attach files button, as the file chooser does.
 *
 * @param page - The browser page.
 * @param files - The files: name, type and bytes.
 * @param within - Where the button is, when the page has more than one (a text being edited).
 */
async function chooseFiles(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  within: Page | Locator = page,
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await within.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles(files);
}

/**
 * Drops a text file on an element, as a file dragged from the desktop.
 *
 * @param page - The browser page.
 * @param target - Where it's dropped.
 * @param name - The file's name.
 * @param text - What it says.
 */
async function dropFile(page: Page, target: Locator, name: string, text: string): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ([fileName, content]) => {
      const data = new DataTransfer();
      data.items.add(new File([content], fileName, { type: 'text/plain' }));
      return data;
    },
    [name, text] as const,
  );
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
}

/**
 * Pastes an image into an element, as a screenshot copied to the clipboard.
 *
 * @param target - Where it's pasted.
 * @param name - The image's name.
 */
async function pasteImage(target: Locator, name: string): Promise<void> {
  await target.evaluate(
    (element, [fileName, bytes]) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], fileName, { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    [name, [...PNG]] as const,
  );
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
  const screenshot = description.getByRole('link', { name: /^Download error\.png, \d+ bytes$/ });
  await expect(screenshot).toBeVisible();

  // The browser kept it, and asks again when the page loads afresh: the same file, not sent again.
  const thumbnail = (await screenshot.getAttribute('href')) ?? '';
  const reloaded = page.waitForResponse((response) => response.url().endsWith(thumbnail));
  await page.reload();
  const checked = await reloaded;
  expect(await checked.request().headerValue('if-none-match')).toBe(`"${thumbnail.split('/')[2]}"`);
  expect(checked.status()).toBe(304);
  await expect(description.locator('img')).toHaveJSProperty('naturalWidth', 1);

  const conversation = page.getByRole('region', { name: 'Conversation' });
  const log = conversation.getByRole('link', { name: 'Download printer.log, 15 bytes' });
  await expect(log).toBeVisible();
  await expect(conversation.getByText('driver notes.txt')).toHaveCount(0);

  // A download under its name, which nothing sniffs or shows elsewhere, and only the reader's
  // browser keeps, asking before each use.
  const download = page.waitForEvent('download');
  await log.click();
  expect((await download).suggestedFilename()).toBe('printer.log');
  const href = (await log.getAttribute('href')) ?? '';
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe('printer offline');
  const etag = `"${href.split('/')[2]}"`;
  expect(response.headers()).toMatchObject({
    'content-disposition': 'attachment; filename="printer.log"; filename*=UTF-8\'\'printer.log',
    'x-content-type-options': 'nosniff',
    etag,
    'cache-control': 'private, no-cache',
    'content-security-policy': "default-src 'none'; sandbox",
  });
  const unchanged = await page.request.get(href, { headers: { 'If-None-Match': etag } });
  expect(unchanged.status()).toBe(304);
  expect(unchanged.headers()).toMatchObject({ etag, 'cache-control': 'private, no-cache' });

  // The note's file is missing to the company, even by its address, and with its tag.
  const asked: Record<string, string>[] = [{}, { 'If-None-Match': `"${noteFile}"` }];
  for (const headers of asked) {
    // eslint-disable-next-line no-await-in-loop -- One answer at a time, each checked.
    const refused = await page.request.get(`/attachments/${noteFile}`, { headers });
    expect(refused.status()).toBe(404);
    expect(refused.headers()['cache-control']).toBe('no-store');
  }
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

test('a company attaches files by button, drop and paste, and sends them with a reply', async ({
  page,
  context,
}) => {
  const number = await storeOwnRequest({ title: 'Files attached to a reply' });
  await context.addCookies(clientCookies());
  await page.goto(`/requests/${number}`);
  const reply = await markdownEditor(page, 'Your reply');
  const waiting = page.getByRole('list', { name: /to send$/ });

  // A kind of file that can't be attached never leaves the browser.
  await chooseFiles(page, [
    { name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
  ]);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'setup.exe can’t be attached.',
  );
  await expect(waiting).toBeHidden();

  await chooseFiles(page, [
    { name: 'printer.log', mimeType: 'text/plain', buffer: Buffer.from('printer offline') },
  ]);
  await dropFile(page, reply, 'driver notes.txt', 'reinstall the driver');
  await pasteImage(reply, 'screenshot.png');
  await expect(page.getByRole('list', { name: '3 files to send' })).toBeVisible();
  await expect(waiting.getByText('15 bytes')).toBeVisible();
  // The pasted screenshot is a file, not a picture in the text.
  await expect(reply.locator('img')).toHaveCount(0);

  // One that isn't sent after all goes again, and focus goes back to the button.
  await waiting.getByRole('button', { name: 'Remove driver notes.txt' }).click();
  await expect(page.getByRole('button', { name: 'Attach files' })).toBeFocused();
  await expect(page.getByRole('list', { name: '2 files to send' })).toBeVisible();

  await reply.fill('The log and a screenshot are attached.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await expect(waiting).toBeHidden();
  const sent = page.getByRole('region', { name: 'Conversation' }).getByRole('list', {
    name: '2 attachments',
  });
  await expect(sent.getByRole('link', { name: 'Download printer.log, 15 bytes' })).toBeVisible();
  await expect(sent.getByRole('link', { name: /^Download screenshot\.png/ })).toBeVisible();
});

test('the staff attach a file to an internal note', async ({ page, context }) => {
  const number = await storeOwnRequest({ title: 'A file on a note' });
  await context.addCookies(adminCookies());
  await page.goto(`/requests/${number}`);
  await page
    .getByRole('tablist', { name: 'Write' })
    .getByRole('tab', { name: 'Internal note' })
    .click();

  await chooseFiles(page, [
    { name: 'driver notes.txt', mimeType: 'text/plain', buffer: Buffer.from('reinstall it') },
  ]);
  await expect(page.getByRole('list', { name: '1 file to send' })).toBeVisible();
  await (await markdownEditor(page, 'Your note')).fill('Driver notes attached.');
  await page.getByRole('button', { name: 'Add note' }).click();

  await expect(toasts(page)).toContainText('Note added.');
  await expect(
    page
      .getByRole('region', { name: 'Conversation' })
      .getByRole('link', { name: 'Download driver notes.txt, 12 bytes' }),
  ).toBeVisible();
});

test('a company raises a request with a screenshot on its description', async ({
  page,
  context,
}) => {
  await context.addCookies(clientCookies());
  await page.goto('/requests/new');
  await page.getByRole('textbox', { name: 'Title' }).fill('A request raised with a screenshot');
  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: /^Bug/ }).click();
  const description = await markdownEditor(page, 'Description');
  await description.fill('The error is in the screenshot.');
  await pasteImage(description, 'error.png');
  await expect(page.getByRole('list', { name: '1 file to send' })).toBeVisible();
  await page.getByRole('button', { name: 'Raise request' }).click();

  await expect(page).toHaveURL(/\/requests\/\d+$/);
  await expect(
    page
      .getByRole('region', { name: 'Description' })
      .getByRole('link', { name: /^Download error\.png/ }),
  ).toBeVisible();
});

test('a company adds a file to its reply while editing it, which doesn’t mark it edited', async ({
  page,
  context,
}) => {
  const number = await storeOwnRequest({ title: 'A file added in an edit' });
  await storeEntries(number, [
    { by: REQUESTS_CLIENT.email, side: 'company', kind: 'comment', text: 'The log follows.' },
  ]);
  await context.addCookies(clientCookies());
  await page.goto(`/requests/${number}`);
  const conversation = page.getByRole('region', { name: 'Conversation' });

  await conversation.getByRole('button', { name: 'Edit reply' }).click();
  // The editor's form: the reply form below has an Attach files button of its own.
  const editing = page
    .locator('form')
    .filter({ has: page.getByRole('textbox', { name: 'Reply', exact: true }) });
  await chooseFiles(
    page,
    [{ name: 'printer.log', mimeType: 'text/plain', buffer: Buffer.from('printer offline') }],
    editing,
  );
  await expect(editing.getByRole('list', { name: '1 file to send' })).toBeVisible();
  await editing.getByRole('button', { name: 'Save' }).click();

  await expect(toasts(page)).toContainText('Saved, with 1 file added.');
  await expect(
    conversation.getByRole('link', { name: 'Download printer.log, 15 bytes' }),
  ).toBeVisible();
  await expect(conversation.getByText('Edited', { exact: true })).toHaveCount(0);
});

test('the staff remove a file, whose place says who removed it, and focus stays in its card', async ({
  page,
  context,
}) => {
  const { number } = await requestWithFiles('A file the staff remove');
  await context.addCookies(adminCookies());
  await page.goto(`/requests/${number}`);
  const description = page.getByRole('region', { name: 'Description' });
  const link = description.getByRole('link', { name: /^Download error\.png/ });
  const href = (await link.getAttribute('href')) ?? '';
  // The copy a browser kept is the file until it's removed.
  const kept = { headers: { 'If-None-Match': `"${href.split('/')[2]}"` } };
  expect((await page.request.get(href, kept)).status()).toBe(304);

  await description.getByRole('button', { name: 'Remove error.png' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Remove error.png?' });
  await dialog.getByRole('button', { name: 'Remove file' }).click();

  await expect(toasts(page)).toContainText('error.png removed.');
  await expect(description.getByText(`Removed by ${PLATFORM_ADMIN.name}`)).toBeVisible();
  await expect(link).toHaveCount(0);
  await expect(description.getByRole('heading', { name: 'Description' })).toBeFocused();
  expect((await page.request.get(href)).status()).toBe(404);
  // A copy kept in a browser is refused too: the server always says whether it's still there.
  expect((await page.request.get(href, kept)).status()).toBe(404);

  // The company sees the same place, and can't remove anything.
  await context.clearCookies();
  await context.addCookies(clientCookies());
  await page.goto(`/requests/${number}`);
  await expect(description.getByText(`Removed by ${PLATFORM_ADMIN.name}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});
