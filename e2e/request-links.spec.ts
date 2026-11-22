/**
 * @file End-to-end tests for the link in an email about a request (decision
 * 0036): a click on it signs its recipient in and opens the request, past
 * the second step, while a change that needs a recent confirmation still
 * asks for one; someone else signed in in the browser and a link that no
 * longer works get its confirmation page first.
 */
import { randomUUID } from 'node:crypto';

import { entryAnchor } from '../src/lib/requests';
import { requestLinkPath } from '../src/lib/sign-in/request-link';
import { findEntryId, storeRequest, storeRequestLink } from './support/db';
import {
  COMPANY_SLUG,
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
  await page.goto('/account/security');
  // The device list marks the session the link started.
  const devices = page.getByRole('region', { name: 'Signed-in devices' });
  await expect(devices.getByRole('row', { name: /This device Email link/ })).toBeVisible();
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

  await page.getByRole('button', { name: /^Continue to [A-Z]+-\d+$/ }).click();
  await expect(page).toHaveURL(`/requests/${number}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // The browser is the link's person's now, not the Admin's.
  await page.goto('/account');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(STEP_UP_CLIENT.name);
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

test('a link opened without a click gets the confirmation page', async ({ page }) => {
  const { number } = await ownRequest(STEP_UP_CLIENT.email);
  const link = requestLinkPath(await storeRequestLink(STEP_UP_CLIENT.email, number));

  // Typing the address doesn't say a person clicked a link in an email the way a click does.
  const response = await page.request.get(link, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toMatch(/\/auth\/request-link\?token=/);
  expect(response.headers()['set-cookie'] ?? '').not.toMatch(/session_token=/);
});
