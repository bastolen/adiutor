/**
 * @file End-to-end tests for companies and their members: the main flow
 * (staff add a company, its admin accepts the invitation and sets up MFA
 * because their role requires it, and someone joins as Client through an
 * invite link), inviting several people at once, an Admin leaving the
 * company themselves, a company's address (its URL name or its ID) and its
 * settings: renaming it (a taken URL name is refused) and deactivating it,
 * which cuts its people off until it's reactivated.
 */
import { randomUUID } from 'node:crypto';

import { addMembership, createCompany, findCompanyId } from './support/db';
import {
  CLIENT_WATCHER,
  COMPANY_NAME,
  COMPANY_SLUG,
  PLATFORM_ADMIN,
  PLATFORM_MANAGER,
} from './support/fixtures';
import {
  createAccountFromInvitation,
  createInviteLink,
  setUpAuthenticator,
  signIn,
  toasts,
  useOwnClientIp,
} from './support/helpers';
import { countEmails, linkIn, waitForEmail, waitForNewEmail } from './support/outbox';
import { expect, test } from './support/test';

test('register a company, accept the invitation and join through a link', async ({
  page,
  context,
}) => {
  // Unique per attempt, so retries don't collide with earlier data.
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `owner-${suffix}@adiutor.test`;
  const clientEmail = `client-${suffix}@adiutor.test`;

  // Staff add a company and invite its admin.
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/companies/new');
  await page.getByLabel('Company name').fill(COMPANY_NAME);
  await expect(page.getByLabel('URL name')).toHaveValue('adiutor-tests-client');
  // That URL name belongs to the seeded company, so pick a unique one.
  await page.getByLabel('URL name').fill(`adiutor-tests-${suffix}`);
  await page.getByLabel("Email of the company's admin").fill(ownerEmail);
  await page.getByRole('button', { name: 'Add company' }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Company added. Invitation sent to ${ownerEmail}.`,
  );

  // The new admin accepts and creates an account.
  await context.clearCookies();
  await page.goto(linkIn(await waitForEmail(ownerEmail)));
  await expect(page.getByRole('heading', { name: `Join ${COMPANY_NAME}` })).toBeVisible();
  await createAccountFromInvitation(
    page,
    'Owner',
    'owner-password-1',
    '/account/security?setup=required',
  );

  // Company Admins must set up MFA before they continue.
  await expect(page.getByText(/^Your role requires MFA\./)).toBeVisible();
  await setUpAuthenticator(page, 'owner-password-1');
  const companyId = await findCompanyId(`adiutor-tests-${suffix}`);
  await page.goto(`/companies/${companyId}`);
  await expect(page.getByRole('heading', { name: COMPANY_NAME })).toBeVisible();

  // They create a single-use Client link.
  await page.getByRole('link', { name: 'Members' }).click();
  const inviteLink = await createInviteLink(page, 'Client');
  expect(inviteLink).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);

  // Someone opens the link signed out, confirms their email and joins.
  await context.clearCookies();
  await page.goto(inviteLink);
  await page.getByLabel('Email').fill(clientEmail);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('status')).toContainText(`we've sent an email to ${clientEmail}`);

  // The link now works only once.
  await page.goto(inviteLink);
  await expect(page.getByRole('heading', { name: "This link can't be used" })).toBeVisible();

  const invitation = await waitForEmail(clientEmail);
  expect(invitation.text).toContain('as Client.');
  await page.goto(linkIn(invitation));
  await createAccountFromInvitation(page, 'Link Joiner', 'client-password-1');
  // The role badge next to the company name, and the matching access.
  await expect(page.getByText('Client', { exact: true })).toBeVisible();
  await expect(page.getByText('Requests are on their way')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);
});

test('an Admin invites several people at once', async ({ page }) => {
  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/companies');
  await page.getByRole('row').filter({ hasText: COMPANY_SLUG }).getByRole('link').click();
  await page.getByRole('link', { name: 'Members' }).click();
  const emails = page.getByLabel('Email addresses');

  // One mistyped address refuses the whole list; the list stays as typed, ready to fix.
  const typed = 'bulk.one@adiutor.test\nbulk.two@adiutor.test, bulk.one@adiutor';
  await emails.fill(typed);
  await page.getByRole('button', { name: 'Send invitations' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'This isn’t a valid email address: bulk.one@adiutor.' }),
  ).toBeVisible();
  await expect(emails).toHaveValue(typed);

  // Fixed addresses: count their emails first, so an earlier run's invitation can't pass.
  const before = {
    one: await countEmails('bulk.one@adiutor.test'),
    two: await countEmails('bulk.two@adiutor.test'),
  };
  await emails.fill('bulk.one@adiutor.test\nbulk.two@adiutor.test, bulk.one@adiutor.test');
  await page.getByRole('button', { name: 'Send invitations' }).click();
  await expect(toasts(page)).toContainText('Sent 2 invitations.');
  // All sent, so the list is cleared for the next ones.
  await expect(emails).toHaveValue('');
  const results = page.getByRole('list', { name: 'Invitation results' });
  await expect(results.getByRole('listitem')).toHaveCount(2);

  expect((await waitForNewEmail('bulk.one@adiutor.test', before.one)).subject).toContain(
    'invited you to join',
  );
  expect((await waitForNewEmail('bulk.two@adiutor.test', before.two)).subject).toContain(
    'invited you to join',
  );
});

test('an Admin leaves the company from their own row, and lands on the dashboard', async ({
  page,
  context,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `leaver-${suffix}@adiutor.test`;
  const companyName = 'Adiutor Tests Leaving';

  await signIn(page, PLATFORM_ADMIN);
  await page.goto('/admin/companies/new');
  await page.getByLabel('Company name').fill(companyName);
  await page.getByLabel('URL name').fill(`adiutor-tests-leaving-${suffix}`);
  await page.getByLabel("Email of the company's admin").fill(ownerEmail);
  await page.getByRole('button', { name: 'Add company' }).click();
  await expect(page.getByRole('status')).toHaveText(
    `Company added. Invitation sent to ${ownerEmail}.`,
  );

  await context.clearCookies();
  await page.goto(linkIn(await waitForEmail(ownerEmail)));
  await createAccountFromInvitation(
    page,
    'Leaver',
    'leaver-password-1',
    '/account/security?setup=required',
  );
  await setUpAuthenticator(page, 'leaver-password-1');
  const companyId = await findCompanyId(`adiutor-tests-leaving-${suffix}`);
  // A second Admin, so the first one may leave.
  await addMembership(companyId, PLATFORM_MANAGER.email, 'admin');

  await page.goto(`/companies/${companyId}/members`);
  // Their own row says so; the other Admin's doesn't.
  const you = page.getByText('You', { exact: true });
  await expect(
    page.getByRole('row').filter({ hasText: 'Leaver' }).filter({ has: you }),
  ).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: PLATFORM_MANAGER.email }).filter({ has: you }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: `Leave ${companyName}` }).click();
  const dialog = page.getByRole('alertdialog', { name: `Leave ${companyName}?` });
  await expect(dialog).toContainText(`You'll no longer be a member of ${companyName}.`);
  await dialog.getByRole('button', { name: 'Leave company' }).click();

  // Not the Members page's 404: the dashboard, saying what happened.
  await expect(page).toHaveURL('/dashboard?notice=left-company');
  await expect(page.getByRole('status').filter({ hasText: 'You left the company.' })).toBeVisible();
});

test('a company opens by its URL name or its ID, and moves with a new URL name', async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Adiutor Tests Address ${suffix}`;
  const slug = `adiutor-tests-address-${suffix}`;
  const companyId = await createCompany({ name, slug });
  await signIn(page, PLATFORM_ADMIN);

  // The companies list links with the URL name.
  await page.goto(`/admin/companies?q=${slug}`);
  await expect(page.getByRole('link', { name })).toHaveAttribute('href', `/companies/${slug}`);

  // Both addresses open the company, and its pages' titles name it.
  await page.goto(`/companies/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page).toHaveTitle(`${name} · Adiutor`);
  await page.goto(`/companies/${companyId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // A new name shows in the header and the title as soon as it's saved.
  await page.goto(`/companies/${slug}/settings`);
  await expect(page).toHaveTitle(`Settings · ${name} · Adiutor`);
  const renamed = `${name} Renamed`;
  await page.getByLabel('Name', { exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(toasts(page)).toContainText('Saved.');
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await expect(page).toHaveTitle(`Settings · ${renamed} · Adiutor`);

  // Another company's URL name is refused, keeping the page and what was typed.
  await page.getByLabel('URL name').fill(COMPANY_SLUG);
  await page.getByRole('button', { name: 'Save changes' }).click();
  const taken = 'That URL name is already in use. Choose another one.';
  await expect(page.getByRole('alert').filter({ hasText: taken })).toBeVisible();
  await expect(toasts(page)).toContainText(taken);
  await expect(page).toHaveURL(`/companies/${slug}/settings`);
  await expect(page.getByLabel('URL name')).toHaveValue(COMPANY_SLUG);

  // A new URL name moves the page to its new address, and the old one no longer opens it.
  await page.getByLabel('URL name').fill(`${slug}-moved`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${slug}-moved/settings\\?saved=1$`));
  await expect(toasts(page)).toContainText('Saved.');
  await page.goto(`/companies/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name })).toHaveCount(0);
});

test("staff deactivate a company from its settings, which cuts its people off until it's reactivated", async ({
  browser,
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Adiutor Tests Paused ${suffix}`;
  const slug = `adiutor-tests-paused-${suffix}`;
  const companyId = await createCompany({ name, slug });
  await addMembership(companyId, CLIENT_WATCHER.email, 'client');

  // One of its people, on a browser of their own.
  const member = await (await browser.newContext()).newPage();
  await useOwnClientIp(member);
  await signIn(member, CLIENT_WATCHER);
  await member.goto(`/companies/${slug}`);
  await expect(member.getByRole('heading', { level: 1, name })).toBeVisible();

  // Staff deactivate it through the confirmation.
  await signIn(page, PLATFORM_ADMIN);
  await page.goto(`/companies/${slug}/settings`);
  await page.getByRole('button', { name: 'Deactivate company' }).click();
  const deactivate = page.getByRole('alertdialog', { name: `Deactivate ${name}?` });
  await deactivate.getByRole('button', { name: 'Deactivate' }).click();
  await expect(deactivate).toHaveCount(0);
  await expect(toasts(page)).toContainText('Company deactivated.');
  // The header (from the company layout) shows it straight away.
  const header = page.getByRole('main');
  await expect(header.getByText('Deactivated', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reactivate company' })).toBeVisible();

  // Its people can't open it meanwhile.
  await member.reload();
  await expect(member.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();

  // Reactivating gives them access again.
  await page.getByRole('button', { name: 'Reactivate company' }).click();
  const reactivate = page.getByRole('alertdialog', { name: `Reactivate ${name}?` });
  await reactivate.getByRole('button', { name: 'Reactivate' }).click();
  await expect(reactivate).toHaveCount(0);
  await expect(toasts(page)).toContainText('Company reactivated.');
  await expect(header.getByText('Deactivated', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deactivate company' })).toBeVisible();

  await member.reload();
  await expect(member.getByRole('heading', { level: 1, name })).toBeVisible();
  await member.context().close();
});
