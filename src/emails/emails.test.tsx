/**
 * @file Tests for the email templates: subjects, links, logo, escaping, the
 * plain-text versions, and every template in every language.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import type { Email } from '@/lib/email';
import { formatDateTime } from '@/lib/format';
import { LOCALES, type Locale } from '@/lib/i18n/locales';
import { SECURITY_NOTICE_KINDS, type SecurityNoticeKind } from '@/lib/security-notice-kinds';

import { accountCreatedEmail } from './account-created';
import { addedToCompanyEmail } from './added-to-company';
import { alreadyInvitedEmail } from './already-invited';
import { alreadyMemberEmail } from './already-member';
import { invitationEmail } from './invitation';
import { invitationReminderEmail } from './invitation-reminder';
import { inviteLinkConfirmationEmail } from './invite-link-confirmation';
import { jobFailingEmail } from './job-failing';
import { magicLinkEmail } from './magic-link';
import { resetPasswordEmail } from './reset-password';
import { securityNoticeEmail } from './security-notice';
import { staffAdminAddedEmail } from './staff-admin-added';
import { twoFactorCodeEmail } from './two-factor-code';
import { verifyEmailEmail } from './verify-email';

/** The app URL used in every test email. */
const appUrl = 'https://adiutor.test';

/** What every English (US) test email shares: the app URL and the language. */
const english = { appUrl, locale: 'en-US' } as const;

/**
 * Changes only an administrator makes to someone's account, whose notices
 * once ended with "If this wasn't you, reset your password": the recipient
 * can't have made them, so the notice says to contact the administrator.
 */
const ADMINISTRATOR_ONLY_KINDS = [
  'signed_out_everywhere',
  'account_reactivated',
  'staff_role_granted',
  'staff_role_changed',
  'staff_role_removed',
] as const satisfies readonly SecurityNoticeKind[];

/**
 * How a security notice ends, per language: `unexpected` after a change only
 * an administrator makes, `reset` after a reset of two-step verification, and
 * `notYou`, the opening of the advice for a change the recipient can make
 * themself (which neither of the others may have).
 */
const NOTICE_ADVICE: Record<Locale, { unexpected: string; reset: string; notYou: string }> = {
  'en-US': {
    unexpected: "If you didn't expect this, contact your administrator.",
    reset:
      "If you didn't ask for this, contact your administrator right away and change your password.",
    notYou: "wasn't you",
  },
  'nl-NL': {
    unexpected: 'Had je dit niet verwacht, neem dan contact op met je beheerder.',
    reset:
      'Heb je dit niet gevraagd, neem dan meteen contact op met je beheerder en wijzig je wachtwoord.',
    notYou: 'Was jij dit niet',
  },
  'es-ES': {
    unexpected: 'Si no lo esperabas, ponte en contacto con tu administrador.',
    reset:
      'Si no lo has pedido, ponte en contacto con tu administrador enseguida y cambia tu contraseña.',
    notYou: 'Si no has sido tú',
  },
};

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
    const email = await magicLinkEmail('jane@adiutor.test', { ...english, url });

    expect(email).toMatchObject({ to: 'jane@adiutor.test', subject: 'Your Adiutor sign-in link' });
    expect(email.text).toContain('expires in 5 minutes');
    expectBasics(email, url);
  });

  it('password reset', async () => {
    const url = `${appUrl}/auth/reset-password?token=abc`;
    const email = await resetPasswordEmail('jane@adiutor.test', { ...english, url });

    expect(email.subject).toBe('Reset your Adiutor password');
    expect(email.text).toContain('Choose a new password');
    expectBasics(email, url);
  });

  it('email verification', async () => {
    const url = `${appUrl}/api/auth/verify-email?token=abc`;
    const email = await verifyEmailEmail('jane@adiutor.test', { ...english, url });

    expect(email.subject).toBe('Verify your Adiutor email address');
    expect(email.text).toContain('Verify email address');
    expectBasics(email, url);
  });
});

describe('two-step verification email', () => {
  it('shows the code first and says it expires', async () => {
    const email = await twoFactorCodeEmail('jane@adiutor.test', { ...english, code: '482915' });

    expect(email.subject).toBe('Your Adiutor sign-in code');
    expect(email.html).toContain('482915');
    // In the email theme's monospace font, so similar characters are easy to tell apart.
    expect(email.html).toMatch(/font-family:ui-monospace[^;"]*;[^"]*">482915</);
    expect(email.html).toContain(`src="${appUrl}/brand/logo.png"`);
    expect(email.text.match(/\d{6}/)?.[0]).toBe('482915');
    expect(email.text).toContain('expires in 5 minutes');
  });

  // It has no link, so it isn't among the templates checked by their main link below.
  it.each(LOCALES)(
    'is written in %s, with the code first and no link to follow',
    async (locale) => {
      const [email, inEnglish] = await Promise.all([
        twoFactorCodeEmail('jane@adiutor.test', { appUrl, locale, code: '482915' }),
        twoFactorCodeEmail('jane@adiutor.test', { ...english, code: '482915' }),
      ]);

      expect(email.html).toContain(`lang="${locale}"`);
      // A missing message throws outside production; a brace would be an argument left unfilled.
      expect(email.subject).not.toMatch(/[{}]/);
      expect(email.text).not.toMatch(/[{}]/);
      // The first six digits in the text are the code, whatever the language says around it.
      expect(email.text.match(/\d{6}/)?.[0]).toBe('482915');
      expect(email.html).toContain('482915');
      // The code is typed where the sign-in is under way: the only address is the footer's, Adiutor.
      expect(email.text.match(/https?:\/\/\S+/g)).toEqual([appUrl]);
      expect(email.text.trimEnd().endsWith(appUrl)).toBe(true);
      if (locale !== 'en-US') {
        expect(email.subject).not.toBe(inEnglish.subject);
        expect(email.text).not.toBe(inEnglish.text);
      }
    },
  );
});

describe('company emails', () => {
  it('invitation names the inviter, the company and the role with what it can do', async () => {
    const url = `${appUrl}/invite/abc`;
    const email = await invitationEmail('jane@adiutor.test', {
      ...english,
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
      ...english,
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
    const expiresAt = new Date('2026-10-25T14:05:00Z');
    const email = await invitationReminderEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'client',
      url,
      expiresAt,
    });

    expect(email.subject).toBe('Reminder: join Adiutor Tests on Adiutor');
    expect(email.html).toContain('Your invitation expires soon');
    expect(email.text).toContain(
      `Sam Doe invited you to join Adiutor Tests on Adiutor as Client. The invitation is still open until Oct 25, 2026, 2:05 PM UTC.`,
    );
    expect(email.text).toContain('replaces the one in the earlier email');
    expectBasics(email, url);
  });

  it('invite-link confirmation asks to confirm the address, without an inviter', async () => {
    const url = `${appUrl}/invite/abc`;
    const email = await inviteLinkConfirmationEmail('jane@adiutor.test', {
      ...english,
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
      ...english,
      companyName: 'Adiutor Tests',
      url,
    });

    expect(email.subject).toBe("You're already a member of Adiutor Tests on Adiutor");
    expect(email.text).toContain('No action is needed.');
    expectBasics(email, url);
  });

  it('already invited points to the earlier invitation and links to the sign-in page', async () => {
    const email = await alreadyInvitedEmail('jane@adiutor.test', {
      ...english,
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
      ...english,
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
      ...english,
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
      ...english,
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
      ...english,
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
      ...english,
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

describe('background jobs', () => {
  it('tells the staff Admins that a recurring job keeps failing, with the error to look up', async () => {
    const url = `${appUrl}/admin/logs/errors?q=7KQ2-M9XD`;
    const email = await jobFailingEmail('alex@adiutor.test', {
      ...english,
      job: 'invitation-reminders',
      failure: 'recurring',
      count: 3,
      reference: '7KQ2-M9XD',
      url,
    });

    expect(email.subject).toBe('Background job invitation-reminders keeps failing on Adiutor');
    expect(email.text).toContain(
      'The background job invitation-reminders failed its last 3 runs in a row.',
    );
    expect(email.text).toContain('Error reference: 7KQ2-M9XD');
    expectBasics(email, url);
  });

  it('tells them that queued jobs were given up, also without a reference', async () => {
    const url = `${appUrl}/admin/logs/errors`;
    const one = await jobFailingEmail('alex@adiutor.test', {
      ...english,
      job: 'security-notice',
      failure: 'queued',
      count: 1,
      reference: null,
      url,
    });
    expect(one.text).toContain('A security-notice job was given up after its last attempt');
    expect(one.text).not.toContain('Error reference');
    expectBasics(one, url);

    const several = await jobFailingEmail('alex@adiutor.test', {
      ...english,
      job: 'security-notice',
      failure: 'queued',
      count: 4,
      reference: null,
      url,
    });
    expect(several.text).toContain('4 security-notice jobs were given up after their last attempt');
  });
});

describe('security notices', () => {
  const when = new Date('2026-10-23T14:05:00Z');

  it('says what changed, when and from where, with a link to the Security page', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'two_factor_disabled',
      when,
      device: 'Firefox on Windows',
      ip: '203.0.113.7',
    });

    expect(email.subject).toBe('Two-step verification was turned off on your Adiutor account');
    expect(email.text).toContain('When: Oct 23, 2026, 2:05 PM UTC');
    expect(email.text).toContain('From: Firefox on Windows, 203.0.113.7');
    expect(email.text).toContain("If this wasn't you, reset your password");
    expectBasics(email, `${appUrl}/account/security`);
  });

  it('names the provider', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'provider_connected',
      when,
      provider: 'GitHub',
    });

    expect(email.subject).toBe('GitHub was connected to your Adiutor account');
    expect(email.text).not.toContain('From:');
  });

  it('has no Security page link for a deactivated account', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'account_deactivated',
      when,
    });

    expect(email.html).not.toContain('/account/security');
    expect(email.text).toContain('contact your administrator');
  });

  it('tells the owner that wrong passwords paused password sign-in, and what still works', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
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
      ...english,
      timeZone: 'UTC',
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
      ...english,
      timeZone: 'UTC',
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
      ...english,
      timeZone: 'UTC',
      kind: 'mfa_reset',
      when,
    });

    expect(email.subject).toBe('Your Adiutor two-step verification was reset');
    expect(email.text).toContain(
      'Any GitHub or Google accounts connected to your Adiutor account were disconnected',
    );
    expect(email.text).toContain('you were signed out everywhere');
    // Only an administrator resets it, and it leaves the password as the only thing in the way.
    expect(email.text).toContain(NOTICE_ADVICE['en-US'].reset);
    expect(email.text).not.toContain("wasn't you");
  });

  it.each(ADMINISTRATOR_ONLY_KINDS)(
    'says to contact the administrator after %s, which the recipient can’t have done',
    async (kind) => {
      const email = await securityNoticeEmail('jane@adiutor.test', {
        ...english,
        timeZone: 'UTC',
        kind,
        when,
      });

      expect(email.text).toContain("If you didn't expect this, contact your administrator.");
      expect(email.text).not.toContain("wasn't you");
      expect(email.text).not.toContain('reset your password right away');
    },
  );

  it.each(SECURITY_NOTICE_KINDS)('renders %s', async (kind) => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind,
      when,
    });
    expect(email.subject).toMatch(/Adiutor/);
    expect(email.subject).not.toMatch(/\{(provider|role|company)\}/);
    expect(email.html).not.toMatch(/\{(provider|role|company)\}/);
    expect(email.text).not.toMatch(/\{(provider|role|company)\}/);
  });

  it('names the company and the role in a changed company role', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'company_role_changed',
      when,
      company: 'Adiutor Tests',
      role: 'admin',
    });

    expect(email.subject).toBe('Your role in Adiutor Tests on Adiutor changed');
    expect(email.html).toContain('Your role in Adiutor Tests changed');
    expect(email.text).toContain('Your role in Adiutor Tests on Adiutor was changed to Admin.');
    expect(email.text).not.toContain('{company}');
    expectBasics(email, `${appUrl}/account/security`);
  });

  it('names the company in a removal from a company', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
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
      ...english,
      timeZone: 'UTC',
      kind: 'removed_from_company',
      when,
    });

    expect(email.subject).toBe('You were removed from your company on Adiutor');
  });

  it('escapes the company name, so it cannot add HTML', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'removed_from_company',
      when,
      company: 'Adiutor <script>Tests</script>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('names the staff member who signed in as the user, and how long it lasts', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'impersonation_started',
      when,
      staffMember: 'Sam Lee',
      staffName: 'Adiutor Tests',
    });

    expect(email.subject).toBe('Sam Lee from Adiutor Tests signed in to Adiutor as you');
    expect(email.html).toContain('Sam Lee signed in as you');
    expect(email.text).toContain(
      "Sam Lee from Adiutor Tests signed in to Adiutor as you, to see what you see and check what isn't working.",
    );
    expect(email.text).toContain('It ends after at most 30 minutes.');
    expect(email.text).toContain('you can turn it off on your Security page.');
    expect(email.text).toContain("If you didn't expect this, contact your administrator.");
    expect(email.text).not.toContain('From:');
    // Straight to the switch for sign-ins by staff.
    expectBasics(email, `${appUrl}/account/security#staff-sign-in`);
  });

  it('says "a staff member" when the notice is built without a name', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'impersonation_started',
      when,
    });

    expect(email.subject).toBe('A staff member from Adiutor signed in to Adiutor as you');
  });

  it('names the staff role', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'staff_role_changed',
      when,
      role: 'manager',
    });
    expect(email.text).toContain('changed your staff role on Adiutor to Manager.');
  });
});

/** A built email of one template in a language, and its main link. */
interface BuiltEmail {
  /** The email. */
  email: Email;
  /** Its main link, the first in the plain text. */
  url: string;
}

/** Builds one email of every template (security notices apart) in a language. */
const EVERY_TEMPLATE: Record<string, (locale: Locale) => Promise<BuiltEmail>> = {
  /**
   * The sign-in link email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'magic link': async (locale) => {
    const url = `${appUrl}/auth/email-link?token=abc`;
    return { email: await magicLinkEmail('jane@adiutor.test', { appUrl, locale, url }), url };
  },
  /**
   * The password reset email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'password reset': async (locale) => {
    const url = `${appUrl}/auth/reset-password?token=abc`;
    return { email: await resetPasswordEmail('jane@adiutor.test', { appUrl, locale, url }), url };
  },
  /**
   * The email verification email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'email verification': async (locale) => {
    const url = `${appUrl}/api/auth/verify-email?token=abc`;
    return { email: await verifyEmailEmail('jane@adiutor.test', { appUrl, locale, url }), url };
  },
  /**
   * The invitation.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  invitation: async (locale) => {
    const url = `${appUrl}/invite/abc`;
    const email = await invitationEmail('jane@adiutor.test', {
      appUrl,
      locale,
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'client',
      url,
      validDays: 7,
    });
    return { email, url };
  },
  /**
   * The invitation reminder.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'invitation reminder': async (locale) => {
    const url = `${appUrl}/invite/abc`;
    const email = await invitationReminderEmail('jane@adiutor.test', {
      appUrl,
      locale,
      timeZone: 'UTC',
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'watcher',
      url,
      expiresAt: new Date('2026-10-25T14:05:00Z'),
    });
    return { email, url };
  },
  /**
   * The invite-link confirmation.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'invite-link confirmation': async (locale) => {
    const url = `${appUrl}/invite/abc`;
    const email = await inviteLinkConfirmationEmail('jane@adiutor.test', {
      appUrl,
      locale,
      companyName: 'Adiutor Tests',
      role: 'admin',
      url,
      validDays: 1,
    });
    return { email, url };
  },
  /**
   * The "already a member" email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'already a member': async (locale) => {
    const url = `${appUrl}/companies/abc`;
    const email = await alreadyMemberEmail('jane@adiutor.test', {
      appUrl,
      locale,
      companyName: 'Adiutor Tests',
      url,
    });
    return { email, url };
  },
  /**
   * The "already invited" email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'already invited': async (locale) => ({
    email: await alreadyInvitedEmail('jane@adiutor.test', {
      appUrl,
      locale,
      companyName: 'Adiutor Tests',
    }),
    url: `${appUrl}/auth`,
  }),
  /**
   * The welcome email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'account created': async (locale) => {
    const url = `${appUrl}/auth/reset-password?token=abc`;
    const email = await accountCreatedEmail('jane@adiutor.test', {
      appUrl,
      locale,
      creatorName: 'Alex Admin',
      staffName: 'Adiutor Tests',
      url,
      validDays: 7,
    });
    return { email, url };
  },
  /**
   * The "added to a company" email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'added to a company': async (locale) => {
    const url = `${appUrl}/companies/abc`;
    const email = await addedToCompanyEmail('jane@adiutor.test', {
      appUrl,
      locale,
      adderName: 'Alex Admin',
      companyName: 'Adiutor Tests',
      role: 'client',
      url,
    });
    return { email, url };
  },
  /**
   * The "job keeps failing" email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'job keeps failing': async (locale) => {
    const url = `${appUrl}/admin/logs/errors?q=7KQ2-M9XD`;
    const email = await jobFailingEmail('alex@adiutor.test', {
      appUrl,
      locale,
      job: 'invitation-reminders',
      failure: 'recurring',
      count: 3,
      reference: '7KQ2-M9XD',
      url,
    });
    return { email, url };
  },
  /**
   * The "new staff Admin" email.
   *
   * @param locale - The language.
   * @returns The email and its main link.
   */
  'new staff Admin': async (locale) => {
    const url = `${appUrl}/admin/staff`;
    const email = await staffAdminAddedEmail('alex@adiutor.test', {
      appUrl,
      locale,
      newAdminName: 'Sam Tester',
      newAdminEmail: 'sam@adiutor.test',
      how: 'invitation',
      byName: 'Jane Admin',
      url,
    });
    return { email, url };
  },
};

describe('every template in every language', () => {
  /** Every template in every language, as `[locale, template]`. */
  const cases = LOCALES.flatMap((locale) =>
    Object.keys(EVERY_TEMPLATE).map((name) => [locale, name] as const),
  );

  it.each(cases)('%s: %s', async (locale, name) => {
    const build = EVERY_TEMPLATE[name];
    if (!build) {
      throw new Error(`No example for ${name}`);
    }
    // A missing message throws outside production, so building it at all says none is missing.
    const [{ email, url }, { email: inEnglish }] = await Promise.all([
      build(locale),
      build('en-US'),
    ]);

    expect(email.html).toContain(`lang="${locale}"`);
    expect(email.subject).not.toMatch(/[{}]/);
    expect(email.text).not.toMatch(/[{}]/);
    expect(email.text.match(/https?:\/\/\S+/)?.[0]).toBe(url);
    if (locale !== 'en-US') {
      expect(email.subject).not.toBe(inEnglish.subject);
      expect(email.text).not.toBe(inEnglish.text);
    }
  });

  it.each(
    LOCALES.flatMap((locale) => SECURITY_NOTICE_KINDS.map((kind) => [locale, kind] as const)),
  )('%s: the %s security notice', async (locale, kind) => {
    const props = { appUrl, kind, when: new Date('2026-10-23T14:05:00Z'), timeZone: 'UTC' };
    const [email, inEnglish] = await Promise.all([
      securityNoticeEmail('jane@adiutor.test', { ...props, locale }),
      securityNoticeEmail('jane@adiutor.test', { ...props, locale: 'en-US' }),
    ]);

    expect(email.html).toContain(`lang="${locale}"`);
    expect(email.subject).not.toMatch(/[{}]/);
    expect(email.text).toContain(
      formatDateTime(props.when, locale, props.timeZone, { zoneName: true }),
    );
    if (locale !== 'en-US') {
      expect(email.subject).not.toBe(inEnglish.subject);
    }
  });

  it.each(
    LOCALES.flatMap((locale) => ADMINISTRATOR_ONLY_KINDS.map((kind) => [locale, kind] as const)),
  )('%s: the %s notice says to contact the administrator', async (locale, kind) => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      locale,
      timeZone: 'UTC',
      kind,
      when: new Date('2026-10-23T14:05:00Z'),
    });

    expect(email.text).toContain(NOTICE_ADVICE[locale].unexpected);
    expect(email.text).not.toContain(NOTICE_ADVICE[locale].notYou);
  });

  it.each(LOCALES)(
    '%s: the notice of a reset of two-step verification has advice of its own',
    async (locale) => {
      const email = await securityNoticeEmail('jane@adiutor.test', {
        appUrl,
        locale,
        timeZone: 'UTC',
        kind: 'mfa_reset',
        when: new Date('2026-10-23T14:05:00Z'),
      });

      expect(email.text).toContain(NOTICE_ADVICE[locale].reset);
      expect(email.text).not.toContain(NOTICE_ADVICE[locale].notYou);
      expect(email.text).not.toContain(NOTICE_ADVICE[locale].unexpected);
    },
  );

  it.each(LOCALES)(
    '%s: a change the recipient can make keeps “if this wasn’t you”',
    async (locale) => {
      const email = await securityNoticeEmail('jane@adiutor.test', {
        appUrl,
        locale,
        timeZone: 'UTC',
        kind: 'two_factor_disabled',
        when: new Date('2026-10-23T14:05:00Z'),
      });

      expect(email.text).toContain(NOTICE_ADVICE[locale].notYou);
    },
  );

  it('lets a language put the company before the inviter in the subject', async () => {
    const props = {
      appUrl,
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'client',
      url: `${appUrl}/invite/abc`,
      validDays: 7,
    } as const;
    expect(
      (await invitationEmail('jane@adiutor.test', { ...props, locale: 'en-US' })).subject,
    ).toBe('Sam Doe invited you to join Adiutor Tests on Adiutor');
    expect(
      (await invitationEmail('jane@adiutor.test', { ...props, locale: 'es-ES' })).subject,
    ).toBe('Invitación a Adiutor Tests en Adiutor de parte de Sam Doe');
    expect(
      (await invitationEmail('jane@adiutor.test', { ...props, locale: 'nl-NL' })).subject,
    ).toBe('Sam Doe nodigt je uit voor Adiutor Tests op Adiutor');
  });

  it('shows times in the recipient’s zone, and names it', async () => {
    const notice = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'America/New_York',
      kind: 'password_changed',
      when: new Date('2026-10-23T14:05:00Z'),
    });
    expect(notice.text).toContain('When: Oct 23, 2026, 10:05 AM EDT');

    const reminder = await invitationReminderEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'Asia/Kolkata',
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'client',
      url: `${appUrl}/invite/abc`,
      expiresAt: new Date('2026-10-25T14:05:00Z'),
    });
    expect(reminder.text).toContain('still open until Oct 25, 2026, 7:35 PM GMT+5:30.');
  });

  it('names roles, dates and the device in the recipient’s language', async () => {
    const reminder = await invitationReminderEmail('jane@adiutor.test', {
      appUrl,
      locale: 'nl-NL',
      timeZone: 'Europe/Amsterdam',
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'watcher',
      url: `${appUrl}/invite/abc`,
      expiresAt: new Date('2026-10-25T14:05:00Z'),
    });
    expect(reminder.text).toContain(
      'Sam Doe nodigt je uit om lid te worden van Adiutor Tests op Adiutor als Meekijker. De uitnodiging staat nog open tot 25 okt 2026, 15:05 CET.',
    );
    const invited = await invitationEmail('jane@adiutor.test', {
      appUrl,
      locale: 'nl-NL',
      inviterName: 'Sam Doe',
      companyName: 'Adiutor Tests',
      role: 'watcher',
      url: `${appUrl}/invite/abc`,
      validDays: 1,
    });
    expect(invited.text).toContain('Volgt verzoeken zonder mee te doen.');
    expect(invited.text).toContain('De link werkt één keer en verloopt over 1 dag.');

    const notice = await securityNoticeEmail('jane@adiutor.test', {
      appUrl,
      locale: 'es-ES',
      timeZone: 'UTC',
      kind: 'company_role_changed',
      when: new Date('2026-10-23T14:05:00Z'),
      device: 'Firefox en Windows',
      ip: '203.0.113.7',
      company: 'Adiutor Tests',
      role: 'client',
    });
    expect(notice.subject).toBe('Ha cambiado tu rol en Adiutor Tests en Adiutor');
    expect(notice.text).toContain('Tu rol en Adiutor Tests en Adiutor ha cambiado a Cliente.');
    expect(notice.text).toContain('Cuándo: 23 oct 2026, 14:05 UTC');
    expect(notice.text).toContain('Desde: Firefox en Windows, 203.0.113.7');
    expect(notice.text).toContain('Enviado por Adiutor');
  });
});
