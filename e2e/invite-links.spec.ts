/**
 * @file End-to-end tests for who may use invite links: Finance and Support
 * staff see why they can't use one instead of the Join button, joining as an
 * Admin from a session without MFA signs you out to set it up, and claiming a
 * link with an address an Admin already invited leaves that invitation
 * working.
 */
import expectAccessible from './support/axe';
import {
  COMPANY_NAME,
  COMPANY_SLUG,
  LINK_JOINER,
  OWNED_COMPANY_SLUG,
  PLATFORM_ADMIN,
  STAFF_NAME,
  SUPPORT_STAFF,
} from './support/fixtures';
import {
  createAccountFromInvitation,
  createInviteLink,
  freshAddress,
  sendInvitation,
  signIn,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { countEmails, linkIn, waitForEmail, waitForNewEmail } from './support/outbox';
import { inOrder } from './support/sequence';
import { expect, test } from './support/test';

test("a Support staff member sees why they can't use an invite link", async ({ page, browser }) => {
  // A staff Admin creates a Client link for the test company.
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/companies/${COMPANY_SLUG}/members`);
  const inviteLink = await createInviteLink(page, 'Client');

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const support = await context.newPage();
  await signIn(support, SUPPORT_STAFF);
  await inOrder(['light', 'dark'] as const, async (colorScheme) => {
    await support.emulateMedia({ colorScheme });
    await support.goto(inviteLink);
    await expect(support.getByText("Finance and Support can't use invite links.")).toBeVisible();
    await expect(support.getByRole('button', { name: 'Join' })).toHaveCount(0);
    await expect(support.getByRole('link', { name: 'Go to your dashboard' })).toBeVisible();
    await expectAccessible(support);
  });
  await context.close();
});

test('joining as an Admin with a link from a session without MFA signs you out to set it up', async ({
  page,
  browser,
}) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/companies/${OWNED_COMPANY_SLUG}/members`);
  const inviteLink = await createInviteLink(page, 'Admin');

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const joiner = await context.newPage();
  await useOwnClientIp(joiner);
  await signIn(joiner, LINK_JOINER);
  await joiner.goto(inviteLink);
  await joiner.getByRole('button', { name: 'Join', exact: true }).click();

  // A link proves no inbox, so the session that joined ends: sign in again, then set up MFA.
  await expect(joiner).toHaveURL(/\/auth\?notice=joined-mfa-required/);
  await expect(joiner.getByText('You’ve joined. Your new role requires MFA')).toBeVisible();
  await expectAccessible(joiner);
  await joiner.goto('/dashboard');
  await expect(joiner).toHaveURL(/\/auth\?callbackURL=/);
  await context.close();
});

test("claiming a link with an address an Admin invited keeps the Admin's invitation working", async ({
  page,
  browser,
}) => {
  const email = freshAddress('invited');

  // A staff Admin invites the address as Client.
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/companies/${COMPANY_SLUG}/members`);
  await sendInvitation(page, email, 'Client');
  await expect(toasts(page)).toContainText(`Invitation sent to ${email}.`);
  const invitation = await waitForEmail(email);

  // Someone holding a Watcher link claims it with that address, signed out.
  const inviteLink = await createInviteLink(page, 'Watcher');
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const visitor = await context.newPage();
  await useOwnClientIp(visitor);
  const before = await countEmails(email);
  await visitor.goto(inviteLink);
  await visitor.getByLabel('Email').fill(email);
  await visitor.getByRole('button', { name: 'Continue' }).click();
  // The same answer as for any address, and the link is used up.
  await expect(visitor.getByRole('status')).toContainText(`we've sent an email to ${email}`);
  await visitor.goto(inviteLink);
  await expect(visitor.getByRole('heading', { name: "This link can't be used" })).toBeVisible();

  // The address is told to use the invitation it already has, which is still the open one.
  expect((await waitForNewEmail(email, before)).subject).toBe(
    `You already have an invitation to ${COMPANY_NAME} on ${STAFF_NAME}`,
  );
  await page.reload();
  // The used link lists the address too, so only the open invitations' table counts.
  const pending = page
    .getByRole('table', { name: /^Open invitations/ })
    .getByRole('row')
    .filter({ hasText: email });
  await expect(pending).toHaveCount(1);
  await expect(pending).not.toContainText('From an invite link');

  // The Admin's invitation still works, with its role.
  await visitor.goto(linkIn(invitation));
  await expect(visitor.getByRole('heading', { name: `Join ${COMPANY_NAME}` })).toBeVisible();
  await createAccountFromInvitation(visitor, 'Invited Client', 'invited-client-password');
  await expect(visitor.getByText('Client', { exact: true })).toBeVisible();
  await context.close();
});
