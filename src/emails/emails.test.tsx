/**
 * @file Tests for the email templates: subjects, links, logo, escaping and
 * the plain-text versions.
 * @vitest-environment node
 */
import { readdir, readFile } from 'node:fs/promises';

import { createElement, type ReactElement } from 'react';
import { render } from 'react-email';
import { describe, expect, it } from 'vitest';

import type { Email } from '@/lib/email';

import { accountCreatedEmail } from './account-created';
import { addedToCompanyEmail } from './added-to-company';
import { alreadyInvitedEmail } from './already-invited';
import { alreadyMemberEmail } from './already-member';
import { invitationEmail } from './invitation';
import { invitationReminderEmail } from './invitation-reminder';
import { inviteLinkConfirmationEmail } from './invite-link-confirmation';
import { magicLinkEmail } from './magic-link';
import { resetPasswordEmail } from './reset-password';
import { SECURITY_NOTICE_KINDS, securityNoticeEmail } from './security-notice';
import { staffAdminAddedEmail } from './staff-admin-added';
import { twoFactorCodeEmail } from './two-factor-code';
import { verifyEmailEmail } from './verify-email';

/** The app URL used in every test email. */
const appUrl = 'https://adiutor.test';

/** A template component with the example data the template preview renders it with. */
type PreviewableTemplate = ((props: Record<string, unknown>) => ReactElement) & {
  /** The example data for `pnpm email:dev`. */
  PreviewProps?: Record<string, unknown>;
};

/** The name (file name without `.tsx`) of every template in this folder, not the helpers or the tests. */
const templateNames = (await readdir('src/emails'))
  .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
  .map((name) => name.slice(0, -'.tsx'.length));

/**
 * Checks what every email needs: the linked logo, the button link in the
 * HTML, and the link on its own in the plain text (followed by whitespace,
 * not a bracket), and nothing about images in the text.
 *
 * @param email - The rendered email.
 * @param url - The email's main link.
 */
function expectBasics(email: Email, url: string) {
  expect(email.html).toContain(`src="${appUrl}/brand/logo.png"`);
  expect(email.html).toContain('alt="Adiutor"');
  expect(email.html).toContain(`href="${url}"`);
  expect(email.text).toMatch(new RegExp(`${url.replace(/[.?/]/g, '\\$&')}(\\s|$)`));
  expect(email.text).not.toContain(`${url}]`);
  expect(email.text).not.toContain('logo.png');
  // The first link in the text is the main one (the end-to-end tests rely on this).
  expect(email.text.match(/https?:\/\/\S+/)?.[0]).toBe(url);
}

describe('account emails', () => {
  it('magic link', async () => {
    const url = `${appUrl}/auth/email-link?token=abc`;
    const email = await magicLinkEmail('jane@adiutor.test', { appUrl, url });

    expect(email).toMatchObject({ to: 'jane@adiutor.test', subject: 'Your Adiutor sign-in link' });
    expect(email.text).toContain('expires in 5 minutes');
    expectBasics(email, url);
  });

  it('password reset', async () => {
    const url = `${appUrl}/auth/reset-password?token=abc`;
    const email = await resetPasswordEmail('jane@adiutor.test', { appUrl, url });

    expect(email.subject).toBe('Reset your Adiutor password');
    expect(email.text).toContain('Choose a new password');
    expectBasics(email, url);
  });

  it('email verification', async () => {
    const url = `${appUrl}/api/auth/verify-email?token=abc`;
    const email = await verifyEmailEmail('jane@adiutor.test', { appUrl, url });

    expect(email.subject).toBe('Verify your Adiutor email address');
    expect(email.text).toContain('Verify email address');
    expectBasics(email, url);
  });
});

describe('two-step verification email', () => {
  it('shows the code first and says it expires', async () => {
    const email = await twoFactorCodeEmail('jane@adiutor.test', { appUrl, code: '482915' });

    expect(email.subject).toBe('Your Adiutor sign-in code');
    expect(email.html).toContain('482915');
    // In the email theme's monospace font, so similar characters are easy to tell apart.
    expect(email.html).toMatch(/font-family:ui-monospace[^;"]*;[^"]*">482915</);
    expect(email.html).toContain(`src="${appUrl}/brand/logo.png"`);
    expect(email.text.match(/\d{6}/)?.[0]).toBe('482915');
    expect(email.text).toContain('expires in 5 minutes');
  });
});

describe('company emails', () => {
  it('invitation names the inviter, the company and the role with what it can do', async () => {
    const url = `${appUrl}/invite/abc`;
    const email = await invitationEmail('jane@adiutor.test', {
      appUrl,
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'client',
      url,
      validDays: 7,
    });

    expect(email.subject).toBe('Sam Doe invited you to join Adiutor Tests on Adiutor');
    expect(email.text).toContain('Sam Doe invited you to join Adiutor Tests on Adiutor as Client.');
    expect(email.text).toContain('Raises requests, comments on them and approves work.');
    expect(email.text).toContain('expires in 7 days');
    // The link has two query parameters, so the HTML escapes the `&`.
    expect(email.html).toContain(`href="${url.replace('&', '&amp;')}"`);
    expect(email.text.match(/https?:\/\/\S+/)?.[0]).toBe(url);
  });

  it('escapes names, so they cannot add HTML', async () => {
    const email = await invitationEmail('jane@adiutor.test', {
      appUrl,
      inviterName: '<b>Sam</b>',
      companyName: 'Adiutor <script>Tests</script>',
      role: 'watcher',
      url: `${appUrl}/invite/abc`,
      validDays: 7,
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>Sam</b>');
    expect(email.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
  });

  it('invitation reminder says the invitation is still open until it expires', async () => {
    const url = `${appUrl}/invite/abc`;
    const expires = '25 Oct 2026, 14:05 UTC';
    const email = await invitationReminderEmail('jane@adiutor.test', {
      appUrl,
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'client',
      url,
      expires,
    });

    expect(email.subject).toBe('Reminder: join Adiutor Tests on Adiutor');
    expect(email.html).toContain('Your invitation expires soon');
    expect(email.text).toContain(
      `Sam Doe invited you to join Adiutor Tests on Adiutor as Client. The invitation is still open until ${expires}.`,
    );
    expect(email.text).toContain('replaces the one in the earlier email');
    expectBasics(email, url);
  });

  it('invite-link confirmation asks to confirm the address, without an inviter', async () => {
    const url = `${appUrl}/invite/abc`;
    const email = await inviteLinkConfirmationEmail('jane@adiutor.test', {
      appUrl,
      companyName: 'Adiutor Tests',
      role: 'client',
      url,
      validDays: 7,
    });

    expect(email.subject).toBe('Confirm your email to join Adiutor Tests');
    expect(email.text).toContain('Confirm this is your email address to join as Client.');
    expectBasics(email, url);
  });

  it('already a member', async () => {
    const url = `${appUrl}/companies/abc`;
    const email = await alreadyMemberEmail('jane@adiutor.test', {
      appUrl,
      companyName: 'Adiutor Tests',
      url,
    });

    expect(email.subject).toBe("You're already a member of Adiutor Tests on Adiutor");
    expect(email.text).toContain('No action is needed.');
    expectBasics(email, url);
  });

  it('already invited points to the earlier invitation and links to the sign-in page', async () => {
    const email = await alreadyInvitedEmail('jane@adiutor.test', {
      appUrl,
      companyName: 'Adiutor Tests',
    });

    expect(email.to).toBe('jane@adiutor.test');
    expect(email.subject).toBe('You already have an invitation to Adiutor Tests on Adiutor');
    expect(email.text).toContain(
      'You opened an invite link for Adiutor Tests on Adiutor, but this email address already has an open invitation there.',
    );
    expect(email.text).toContain('Use the invitation email you received earlier to join.');
    expect(email.text).toContain('ask whoever invited you to send you a new one');
    expect(email.text).toContain("You're receiving this because someone used an invite link");
    // It carries no invitation, only the way to the sign-in page.
    expect(email.text).not.toContain('/invite/');
    expectBasics(email, `${appUrl}/auth`);
  });

  it('already invited escapes the name, so it cannot add HTML', async () => {
    const email = await alreadyInvitedEmail('jane@adiutor.test', {
      appUrl,
      companyName: 'Adiutor <script>Tests</script>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('staff-made changes', () => {
  it('welcome email for a registered account', async () => {
    const url = `${appUrl}/auth/reset-password?token=abc&welcome=1`;
    const email = await accountCreatedEmail('jane@adiutor.test', {
      appUrl,
      creatorName: 'Alex Admin',
      staffName: 'Adiutor Tests',
      url,
      validDays: 7,
    });

    expect(email.subject).toBe('Your Adiutor account is ready');
    expect(email.text).toContain('Alex Admin of Adiutor Tests created an Adiutor account for you.');
    expect(email.text).toContain('expires in 7 days');
    // The link has two query parameters, so the HTML escapes the `&`.
    expect(email.html).toContain(`href="${url.replace('&', '&amp;')}"`);
    expect(email.text.match(/https?:\/\/\S+/)?.[0]).toBe(url);
  });

  it('added to a company', async () => {
    const url = `${appUrl}/companies/abc`;
    const email = await addedToCompanyEmail('jane@adiutor.test', {
      appUrl,
      adderName: 'Alex Admin',
      companyName: 'Adiutor Tests',
      role: 'client',
      url,
    });

    expect(email.subject).toBe('You were added to Adiutor Tests on Adiutor');
    expect(email.text).toContain('Alex Admin added you to Adiutor Tests on Adiutor as Client.');
    expectBasics(email, url);
  });

  it('tells the staff Admins about a new staff Admin, and how they became one', async () => {
    const url = `${appUrl}/admin/staff`;
    const made = await staffAdminAddedEmail('alex@adiutor.test', {
      appUrl,
      newAdminName: 'Sam Tester',
      newAdminEmail: 'sam@adiutor.test',
      how: 'role',
      byName: 'Jane Admin',
      url,
    });
    expect(made.subject).toBe('Sam Tester is now a staff Admin on Adiutor');
    expect(made.text).toContain('Jane Admin made Sam Tester (sam@adiutor.test) a staff Admin');
    expect(made.text).toContain('remove their staff access on the staff page');
    expect(made.text).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expectBasics(made, url);

    const invited = await staffAdminAddedEmail('alex@adiutor.test', {
      appUrl,
      newAdminName: 'sam@adiutor.test',
      newAdminEmail: 'sam@adiutor.test',
      how: 'invitation',
      byName: null,
      url,
    });
    expect(invited.text).toContain(
      'sam@adiutor.test accepted an invitation to the staff and is now a staff Admin',
    );
    expect(invited.text).not.toContain('(sam@adiutor.test)');
  });
});

describe('security notices', () => {
  const when = '23 Oct 2026, 14:05 UTC';

  it('says what changed, when and from where, with a link to the Security page', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'two_factor_disabled',
      when,
      device: 'Firefox on Windows',
      ip: '203.0.113.7',
    });

    expect(email.subject).toBe('Two-step verification was turned off on your Adiutor account');
    expect(email.text).toContain(`When: ${when}`);
    expect(email.text).toContain('From: Firefox on Windows, 203.0.113.7');
    expect(email.text).toContain("If this wasn't you, reset your password");
    expectBasics(email, `${appUrl}/account/security`);
  });

  it('names the provider', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'provider_connected',
      when,
      provider: 'GitHub',
    });

    expect(email.subject).toBe('GitHub was connected to your Adiutor account');
    expect(email.text).not.toContain('From:');
  });

  it('has no Security page link for a deactivated account', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'account_deactivated',
      when,
    });

    expect(email.html).not.toContain('/account/security');
    expect(email.text).toContain('contact your administrator');
  });

  it('tells the owner that wrong passwords paused password sign-in, and what still works', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'password_sign_in_paused',
      when,
    });

    expect(email.subject).toBe('Password sign-in to your Adiutor account is paused');
    expect(email.text).toContain("No one signed in: the password wasn't accepted.");
    expect(email.text).toContain('sign in with an email link or a passkey');
    expect(email.text).toContain('resetting your password lifts the pause');
    expect(email.text).toContain("If this wasn't you, someone may be guessing your password.");
    expect(email.text).not.toContain('reset your password right away');
    expect(email.text).toContain('We send it at most once a day.');
    expect(email.text).not.toContain('a security setting changed');
    expectBasics(email, `${appUrl}/account/security`);
  });

  it('has no Security page link for a deleted account', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'account_deleted',
      when,
    });

    expect(email.subject).toBe('Your Adiutor account was deleted');
    expect(email.html).not.toContain('/account/security');
    expect(email.text).not.toContain('/account/security');
    expect(email.text).toContain("You can't sign in with it any more.");
    expect(email.text).toContain('contact your administrator');
    expect(email.text).toContain('because your Adiutor account was deleted');
  });

  it('tells the owner that wrong codes paused signing in with a code, and to change the password', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'two_factor_locked',
      when,
    });

    expect(email.subject).toBe('Signing in to your Adiutor account with a code is paused');
    expect(email.text).toContain('paused for 15 minutes');
    expect(email.text).toContain("No one signed in: the codes weren't accepted.");
    expect(email.text).toContain("If this wasn't you, someone may know your password.");
    expect(email.text).toContain('Change it right away');
    expect(email.text).not.toContain('reset your password right away');
    expect(email.text).toContain('because of failed sign-in attempts');
    expect(email.text).not.toContain('a security setting changed');
    expectBasics(email, `${appUrl}/account/security`);
  });

  it('says that a reset of two-step verification also disconnected GitHub and Google', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'mfa_reset',
      when,
    });

    expect(email.subject).toBe('Your Adiutor two-step verification was reset');
    expect(email.text).toContain(
      'Any GitHub or Google accounts connected to your Adiutor account were disconnected',
    );
    expect(email.text).toContain('you were signed out everywhere');
  });

  it.each(SECURITY_NOTICE_KINDS)('renders %s', async (kind) => {
    const email = await securityNoticeEmail('jane@adiutor.test', { appUrl, kind, when });
    expect(email.subject).toMatch(/Adiutor/);
    expect(email.subject).not.toMatch(/\{(provider|role|company)\}/);
    expect(email.html).not.toMatch(/\{(provider|role|company)\}/);
    expect(email.text).not.toMatch(/\{(provider|role|company)\}/);
  });

  it('names the company and the role in a changed company role', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'company_role_changed',
      when,
      company: 'Adiutor Tests',
      role: 'Admin',
    });

    expect(email.subject).toBe('Your role in Adiutor Tests on Adiutor changed');
    expect(email.html).toContain('Your role in Adiutor Tests changed');
    expect(email.text).toContain('Your role in Adiutor Tests on Adiutor was changed to Admin.');
    expect(email.text).not.toContain('{company}');
    expectBasics(email, `${appUrl}/account/security`);
  });

  it('names the company in a removal from a company', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'removed_from_company',
      when,
      company: 'Adiutor Tests',
    });

    expect(email.subject).toBe('You were removed from Adiutor Tests on Adiutor');
    expect(email.text).toContain('You were removed from Adiutor Tests on Adiutor');
    expect(email.text).toContain("If you didn't expect this, contact your administrator.");
    expect(email.text).not.toContain('{company}');
  });

  it('falls back to "your company" when the notice is built without a company name', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'removed_from_company',
      when,
    });

    expect(email.subject).toBe('You were removed from your company on Adiutor');
  });

  it('escapes the company name, so it cannot add HTML', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'removed_from_company',
      when,
      company: 'Adiutor <script>Tests</script>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('names the staff role', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      kind: 'staff_role_changed',
      when,
      role: 'Manager',
    });
    expect(email.text).toContain('changed your staff role on Adiutor to Manager.');
  });
});

describe('template preview', () => {
  it('finds the templates', () => {
    expect(templateNames).toContain('magic-link');
    expect(templateNames).toContain('invitation-reminder');
  });

  it.each(templateNames)('renders %s with its PreviewProps', async (name) => {
    const { default: Template } = (await import(/* @vite-ignore */ `./${name}.tsx`)) as {
      default: PreviewableTemplate;
    };

    expect(Template.PreviewProps).toMatchObject({
      appUrl: 'https://adiutor.dev',
      logoSrc: '/static/logo.png',
    });
    const [html, text] = await Promise.all([
      render(createElement(Template, Template.PreviewProps)),
      render(createElement(Template, Template.PreviewProps), { plainText: true }),
    ]);
    expect(html).toContain('src="/static/logo.png"');
    expect(html).toContain('alt="Adiutor"');
    expect(text).toContain('Adiutor');
  });
});

describe('logo', () => {
  it('is the same file in the app and in the template preview', async () => {
    const [app, preview] = await Promise.all([
      readFile('public/brand/logo.png'),
      readFile('src/emails/static/logo.png'),
    ]);
    expect(preview.equals(app)).toBe(true);
  });
});
