/**
 * @file End-to-end tests for the link in an email about a request (decision
 * 0036): a click on it signs its recipient in and opens the request, past
 * the second step, while a change that needs a recent confirmation still
 * asks for one; someone else signed in in the browser and a link that no
 * longer works get its confirmation page first, and only its Continue (a
 * POST) switches accounts, never a link to it written in a reply. Where the
 * browser doesn't say a person clicked (Safari), the page continues by itself
 * when nobody is signed in (decision 0038).
 */
import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { entryAnchor } from '../src/lib/requests';
import { requestLinkPath } from '../src/lib/sign-in/request-link';
import { findEntryId, storeEntries, storeRequest, storeRequestLink } from './support/db';
import {
  COMPANY_SLUG,
  E2E_BASE_URL,
  PLATFORM_ADMIN,
  STEP_UP_CLIENT,
  STEP_UP_MANAGER,
  SUPPORT_STAFF,
} from './support/fixtures';
import { clickLinkInEmail, signIn, signOut, toasts } from './support/helpers';
import { linkIn, waitForEmailAbout } from './support/outbox';
import { expect, test } from './support/test';

/**
 * Stores a request of the test's own, raised by someone at the test company.
 *
 * @param raisedBy - The address of whoever raised it.
 * @returns Its title and number.
 */
async function ownRequest(raisedBy: string): Promise<{ title: string; number: number }> {
  const title = `Link sign-in ${randomUUID().slice(0, 8)}`;
  const number = await storeRequest({ companySlug: COMPANY_SLUG, raisedBy, title });
  return { title, number };
}

test('the link in an email about a request signs its reader in and opens the request', async ({
  page,
}) => {
  // Whoever raised it follows it; a reply from the staff emails them.
  const { title, number } = await ownRequest(STEP_UP_CLIENT.email);
  await signIn(page, SUPPORT_STAFF);
  await page.goto(`/requests/${number}`);
  await page.getByRole('textbox', { name: 'Your reply' }).fill('Is it plugged in?');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(toasts(page)).toContainText('Reply sent.');
  await signOut(page);

  const email = await waitForEmailAbout(STEP_UP_CLIENT.email, title);
  expect(email.text).toContain(
    'The links in this email sign you in to Adiutor for 14 days, so don’t forward it.',
  );
  // Signed out, with an authenticator app: the link opens the request at the reply, without the
  // step-up page.
  await clickLinkInEmail(page, linkIn(email));
  await expect(page).toHaveURL(
    new RegExp(`/requests/${number}\\?entry=([0-9a-f-]{36})#entry-\\1$`),
  );
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // The rest of the app is open too, but adding a way in asks for the second step first.
  // The device list marks the session the link started.
  await page.goto('/account/activity');
  const devices = page.getByRole('region', { name: 'Signed-in devices' });
  await expect(devices.getByRole('row', { name: /This device Email link/ })).toBeVisible();
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Add passkey' }).click();
  await expect(page).toHaveURL(/\/auth\/verify\?callbackURL=%2Faccount%2Fsecurity%23passkeys/);
  await expect(page.getByRole('heading', { name: /^Confirm it.s you$/ })).toBeVisible();

  // Clicked again, it opens the request in the session it started.
  await clickLinkInEmail(page, linkIn(email));
  await expect(page).toHaveURL(
    new RegExp(`/requests/${number}\\?entry=([0-9a-f-]{36})#entry-\\1$`),
  );
});

test('a link to a reply further back than the latest shows the conversation down to it', async ({
  page,
}) => {
  // More replies than the conversation shows at first (50): the 30th has 90 newer ones.
  const number = await storeRequest({
    companySlug: COMPANY_SLUG,
    raisedBy: STEP_UP_CLIENT.email,
    title: `Far back ${randomUUID().slice(0, 8)}`,
    earlierReplies: 120,
  });
  const reply = await findEntryId(number, 'Earlier reply 30, to make the conversation long.');
  const token = await storeRequestLink(STEP_UP_CLIENT.email, number);
  const entry = page.locator(`#${entryAnchor(reply)}`);

  // The link names the reply with its anchor, as the email's does: the page shows it, and
  // everything newer, and brings it into view with the focus on it.
  await clickLinkInEmail(page, `${requestLinkPath(token, { entry: reply })}#${entryAnchor(reply)}`);
  await expect(entry).toContainText('Earlier reply 30, to make the conversation long.');
  await expect(entry).toBeInViewport();
  await expect(entry).toBeFocused();

  // What's older still is a link away, which goes on from there.
  await page.getByRole('link', { name: 'Show earlier activity (20 more)' }).click();
  await expect(page.getByText('Earlier reply 1, to make the conversation long.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Show earlier activity/ })).toHaveCount(0);
});

test('a Manager is signed in without the second step, which a grant still asks for', async ({
  page,
}) => {
  const { title, number } = await ownRequest(STEP_UP_CLIENT.email);
  const link = requestLinkPath(await storeRequestLink(STEP_UP_MANAGER.email, number));

  await clickLinkInEmail(page, link);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // A company's Admin role gives a lasting way in: the invite form asks for a confirmation first.
  await page.goto(`/companies/${COMPANY_SLUG}/members`);
  const invite = page.locator('form').filter({ has: page.getByLabel('Email addresses') });
  await expect(invite.getByRole('button', { name: 'Send invitations' })).toBeVisible();
  await invite.getByRole('combobox', { name: 'Role', exact: true }).click();
  await page.getByRole('option', { name: /^Admin/ }).click();
  await expect(invite.getByRole('button', { name: 'Send invitations' })).toHaveCount(0);
  await expect(invite.getByRole('link', { name: /^Confirm it.s you$/ })).toBeVisible();
});

test('someone else signed in is asked before the link switches accounts', async ({ page }) => {
  const { title, number } = await ownRequest(STEP_UP_CLIENT.email);
  const link = requestLinkPath(await storeRequestLink(STEP_UP_CLIENT.email, number));
  await signIn(page, PLATFORM_ADMIN);

  await clickLinkInEmail(page, link);
  await expect(page).toHaveURL(/\/auth\/request-link\?token=/);
  const reference = new RegExp(`^Open [A-Z]+-${number}$`);
  await expect(page.getByRole('heading', { level: 1, name: reference })).toBeVisible();
  await expect(page.getByText(STEP_UP_CLIENT.email, { exact: true })).toBeVisible();
  await expect(page.getByText(`You're signed in as ${PLATFORM_ADMIN.name}`)).toBeVisible();

  // Continue posts the link, naming the site as its origin (which Better Auth checks).
  const [posted] = await Promise.all([
    page.waitForRequest((sent) => sent.url().includes('/api/auth/request-link/')),
    page.getByRole('button', { name: /^Continue to [A-Z]+-\d+$/ }).click(),
  ]);
  expect(posted.method()).toBe('POST');
  expect(await posted.headerValue('origin')).toBe(new URL(E2E_BASE_URL).origin);
  await expect(page).toHaveURL(`/requests/${number}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // The browser is the link's person's now, not the Admin's.
  await page.goto('/account');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(STEP_UP_CLIENT.name);
});

test('a request link written in a reply never switches whoever clicks it', async ({
  context,
  page,
}) => {
  const { number } = await ownRequest(STEP_UP_CLIENT.email);
  const token = await storeRequestLink(STEP_UP_CLIENT.email, number);
  // Someone writes their own link in a reply, marked the way the confirmation page's Continue
  // used to be.
  await storeEntries(number, [
    {
      by: STEP_UP_CLIENT.email,
      side: 'company',
      kind: 'comment',
      text: `[Open it](${E2E_BASE_URL}${requestLinkPath(token)}&confirmed=1)`,
    },
  ]);
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/requests/${number}`);

  // A click on it is a same-origin click, but no Continue: the confirmation page asks.
  const [opened, request] = await Promise.all([
    context.waitForEvent('page'),
    context.waitForEvent('request', (sent) => sent.url().includes('/api/auth/request-link/')),
    page.getByRole('link', { name: /^Open it/ }).click(),
  ]);
  expect(request.method()).toBe('GET');
  expect(await request.headerValue('sec-fetch-site')).toBe('same-origin');
  expect(await request.headerValue('sec-fetch-user')).toBe('?1');
  await expect(opened).toHaveURL(/\/auth\/request-link\?token=/);
  await expect(opened.getByText(`You're signed in as ${PLATFORM_ADMIN.name}`)).toBeVisible();
  // The browser is still the Admin's.
  await page.goto('/account');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(PLATFORM_ADMIN.name);
});

test("another site's form with someone's link never signs in whoever presses it", async ({
  page,
}) => {
  const { number } = await ownRequest(STEP_UP_CLIENT.email);
  const token = await storeRequestLink(STEP_UP_CLIENT.email, number);
  await signIn(page, PLATFORM_ADMIN);
  // A page on another site posts the link the way the confirmation page's Continue does.
  const form = 'http://mail.adiutor.test/form';
  await page.route(form, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<form method="post" action="${E2E_BASE_URL}/api/auth/request-link/sign-in"><input type="hidden" name="token" value="${token}"><button>View</button></form>`,
    }),
  );
  await page.goto(form);

  const [response] = await Promise.all([
    page.waitForResponse((answer) => answer.url().includes('/api/auth/request-link/')),
    page.getByRole('button', { name: 'View' }).click(),
  ]);
  // Better Auth refuses another site's form, and nothing changes.
  expect(response.status()).toBe(403);
  await page.goto('/account');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(PLATFORM_ADMIN.name);
});

test('a link that no longer works says so, and signing in returns to the request', async ({
  page,
}) => {
  const { number } = await ownRequest(STEP_UP_CLIENT.email);
  const link = requestLinkPath(
    await storeRequestLink(STEP_UP_CLIENT.email, number, { ended: true }),
  );

  await clickLinkInEmail(page, link);
  await expect(page.getByRole('heading', { name: "This link can't be used" })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
    'href',
    `/auth?callbackURL=%2Frequests%2F${number}`,
  );
  // Nothing signed in.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/auth\?callbackURL=%2Fdashboard/);
});

/**
 * Opens a link the way a browser that never says a person clicked does
 * (Safari sends no `Sec-Fetch-User`): a mail app's page that forwards to it
 * by itself, so Chromium sends no `Sec-Fetch-User` either.
 *
 * @param page - The page.
 * @param url - The link, a path of the app.
 */
async function openLinkWithoutClick(page: Page, url: string): Promise<void> {
  const mail = 'http://mail.adiutor.test/';
  const href = new URL(url, E2E_BASE_URL).toString();
  await page.route(mail, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<meta http-equiv="refresh" content="0;url=${href.replaceAll('"', '&quot;')}">`,
    }),
  );
  await page.goto(mail);
}

test('a link opened without a click goes on from its confirmation page by itself', async ({
  page,
}) => {
  const { title, number } = await ownRequest(STEP_UP_CLIENT.email);
  const link = requestLinkPath(await storeRequestLink(STEP_UP_CLIENT.email, number));

  // A program that only fetches the link (a mail scanner) gets the page, which has no form for it.
  const response = await page.request.get(link, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toMatch(/\/auth\/request-link\?token=/);
  expect(response.headers()['set-cookie'] ?? '').not.toMatch(/session_token=/);

  // A browser that doesn't say a person clicked gets the page too, which continues by itself to the
  // request, without a press on Continue.
  const pages: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      pages.push(new URL(frame.url()).pathname);
    }
  });
  await openLinkWithoutClick(page, link);
  await expect(page).toHaveURL(`/requests/${number}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  expect(pages).toContain('/auth/request-link');
  await page.goto('/account/activity');
  const devices = page.getByRole('region', { name: 'Signed-in devices' });
  await expect(devices.getByRole('row', { name: /This device Email link/ })).toBeVisible();
});

test('with someone else signed in, a link opened without a click still asks', async ({ page }) => {
  const { title, number } = await ownRequest(STEP_UP_CLIENT.email);
  const link = requestLinkPath(await storeRequestLink(STEP_UP_CLIENT.email, number));
  await signIn(page, PLATFORM_ADMIN);
  // Every Continue the page sends.
  const continued: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/auth/request-link/')) {
      continued.push(request.url());
    }
  });

  await openLinkWithoutClick(page, link);
  await expect(page).toHaveURL(/\/auth\/request-link\?token=/);
  await expect(page.getByText(`You're signed in as ${PLATFORM_ADMIN.name}`)).toBeVisible();
  // Once the page runs (Continue is enabled) and its effects have run, it still waits for a click.
  const button = page.getByRole('button', { name: /^Continue to [A-Z]+-\d+$/ });
  await expect(button).toBeEnabled();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      }),
  );
  expect(continued).toEqual([]);
  await expect(button).not.toHaveAttribute('aria-busy', 'true');

  await button.click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  expect(continued).toHaveLength(1);
});
