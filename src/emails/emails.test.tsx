/**
 * @file Tests for the email templates: subjects, links, logo, escaping, the
 * plain-text versions, every template in every language, and the staff's
 * name in place of Adiutor's, with "Powered by Adiutor" once it's their own.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_EMAIL_COLOURS, emailColoursOf, emailName } from '@/components/email/theme';
import { derivePalette } from '@/lib/branding';
import type { Email } from '@/lib/email';
import { formatDateTime } from '@/lib/format';
import { LOCALES, type Locale } from '@/lib/i18n/locales';
import { SECURITY_NOTICE_KINDS, type SecurityNoticeKind } from '@/lib/security-notice-kinds';

import { accountCreatedEmail } from './account-created';
import { addedToCompanyEmail } from './added-to-company';
import { alreadyInvitedEmail } from './already-invited';
import { alreadyMemberEmail } from './already-member';
import type { EmailBrand } from './base-props';
import { invitationEmail } from './invitation';
import { invitationReminderEmail } from './invitation-reminder';
import { inviteLinkConfirmationEmail } from './invite-link-confirmation';
import { jobFailingEmail } from './job-failing';
import { magicLinkEmail } from './magic-link';
import { requestUpdateEmail } from './request-update';
import { resetPasswordEmail } from './reset-password';
import { securityNoticeEmail } from './security-notice';
import { smtpChangedEmail } from './smtp-changed';
import { smtpTestEmail } from './smtp-test';
import { staffAdminAddedEmail } from './staff-admin-added';
import { twoFactorCodeEmail } from './two-factor-code';
import { verifyEmailEmail } from './verify-email';
import { webhookTurnedOffEmail } from './webhook-turned-off';

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
 * Checks what every email needs: the linked logo with the staff's name as
 * its alt text, the button link in the HTML, and the link on its own in the
 * plain text (followed by whitespace, not a bracket), and nothing about
 * images in the text.
 *
 * @param email - The rendered email.
 * @param url - The email's main link.
 * @param staff - The staff's name the email was built with.
 */
function expectBasics(email: Email, url: string, staff = 'Adiutor') {
  expect(email.html).toContain(`src="${appUrl}/brand/logo.png"`);
  expect(email.html).toContain(`alt="${staff}"`);
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

    expect(email).toMatchObject({
      to: 'jane@adiutor.test',
      subject: 'Your sign-in link for Adiutor',
    });
    expect(email.text).toContain('expires in 5 minutes');
    expectBasics(email, url);
  });

  it('password reset', async () => {
    const url = `${appUrl}/auth/reset-password?token=abc`;
    const email = await resetPasswordEmail('jane@adiutor.test', { ...english, url });

    expect(email.subject).toBe('Reset your password for Adiutor');
    expect(email.text).toContain('Choose a new password');
    expectBasics(email, url);
  });

  it('email verification', async () => {
    const url = `${appUrl}/api/auth/verify-email?token=abc`;
    const email = await verifyEmailEmail('jane@adiutor.test', { ...english, url });

    expect(email.subject).toBe('Verify your email address for Adiutor');
    expect(email.text).toContain('Verify email address');
    expectBasics(email, url);
  });
});

describe('two-step verification email', () => {
  it('shows the code first and says it expires', async () => {
    const email = await twoFactorCodeEmail('jane@adiutor.test', { ...english, code: '482915' });

    expect(email.subject).toBe('Your sign-in code for Adiutor');
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
      target: 'company',
      role: 'client',
      url,
      validDays: 7,
    });

    expect(email.subject).toBe('Sam Doe invited you to join Adiutor Tests on Adiutor');
    expect(email.text).toContain('Sam Doe invited you to join Adiutor Tests on Adiutor as Client.');
    expect(email.text).toContain('Raises requests, comments on them and approves work.');
    expect(email.text).toContain('expires in 7 days');
    expectBasics(email, url);
  });

  it('escapes names, so they cannot add HTML', async () => {
    const email = await invitationEmail('jane@adiutor.test', {
      ...english,
      inviterName: '<b>Sam</b>',
      companyName: 'Adiutor <script>Tests</script>',
      target: 'company',
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
      target: 'company',
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
      target: 'company',
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
      target: 'company',
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
      target: 'company',
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
      target: 'company',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('names the staff once in an invitation to the staff, whose name is the company’s', async () => {
    const brand: EmailBrand = { colours: DEFAULT_EMAIL_COLOURS, name: 'Adiutor Tests' };
    const toStaff = { ...english, brand, companyName: 'Adiutor Tests', target: 'staff' } as const;
    const url = `${appUrl}/invite/abc`;
    const [invited, reminded, confirm, member, alreadyInvited] = await Promise.all([
      invitationEmail('jane@adiutor.test', {
        ...toStaff,
        inviterName: 'Sam Doe',
        role: 'manager',
        url,
        validDays: 7,
      }),
      invitationReminderEmail('jane@adiutor.test', {
        ...toStaff,
        timeZone: 'UTC',
        inviterName: 'Sam Doe',
        role: 'support',
        url,
        expiresAt: new Date('2026-10-25T14:05:00Z'),
      }),
      inviteLinkConfirmationEmail('jane@adiutor.test', {
        ...toStaff,
        role: 'finance',
        url,
        validDays: 1,
      }),
      alreadyMemberEmail('jane@adiutor.test', { ...toStaff, url: `${appUrl}/dashboard` }),
      alreadyInvitedEmail('jane@adiutor.test', toStaff),
    ]);

    expect(invited.subject).toBe('Sam Doe invited you to join Adiutor Tests');
    expect(invited.html).toContain('Join Adiutor Tests as Manager');
    expect(invited.text).toContain('Sam Doe invited you to join Adiutor Tests as Manager.');
    expect(reminded.subject).toBe('Reminder: join Adiutor Tests');
    expect(reminded.text).toContain('Sam Doe invited you to join Adiutor Tests as Support.');
    expect(confirm.html).toContain('One more step to join Adiutor Tests');
    expect(member.subject).toBe("You're already a member of Adiutor Tests");
    expect(member.text).toContain(
      "Someone tried to invite you to Adiutor Tests, but you're already a member.",
    );
    expect(alreadyInvited.subject).toBe('You already have an invitation to Adiutor Tests');
    expect(alreadyInvited.text).toContain('You opened an invite link for Adiutor Tests, but');
    expect(alreadyInvited.text).toContain('Go to Adiutor Tests');
    for (const email of [invited, reminded, confirm, member, alreadyInvited]) {
      expect(`${email.subject}\n${email.html}`).not.toContain('Adiutor Tests on Adiutor Tests');
    }
  });
});

describe('staff-made changes', () => {
  it('welcome email for a registered account', async () => {
    const url = `${appUrl}/auth/reset-password?token=abc&welcome=1`;
    const email = await accountCreatedEmail('jane@adiutor.test', {
      ...english,
      brand: { colours: DEFAULT_EMAIL_COLOURS, name: 'Adiutor Tests' },
      creatorName: 'Alex Admin',
      url,
      validDays: 7,
    });

    expect(email.subject).toBe('Your account on Adiutor Tests is ready');
    expect(email.text).toContain('Alex Admin of Adiutor Tests created an account for you.');
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

  it('tells someone on a request what happened to it, with the reply in full', async () => {
    // The reader's own link, which signs them in (decision 0036).
    const url = `${appUrl}/api/auth/request-link/sign-in?token=adiutor-tests-token`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: 'Adiutor Tests',
      url,
      role: 'subscriber',
      audience: 'contributor',
      items: [
        {
          event: 'reply',
          by: 'Sam Support',
          text: {
            text: 'Is it **plugged in**?\n\nSee https://adiutor.test/manual and ![a photo](https://adiutor.test/p.png).',
            format: 'markdown',
            mentions: {},
          },
        },
        { event: 'status', by: 'Sam Support', bySide: 'staff', from: 'in_progress', to: 'waiting' },
        { event: 'status', by: 'Casey Client', bySide: 'company', from: 'waiting', to: 'done' },
        { event: 'status', by: 'Casey Client', bySide: 'company', from: 'done', to: 'open' },
        { event: 'assigned', by: 'Morgan Manager' },
        { event: 'subscribed', by: 'Anna Admin' },
        {
          event: 'mentioned',
          by: 'Casey Client',
          where: 'description',
          text: { text: 'It prints blank pages.', format: 'plain', mentions: {} },
        },
        {
          event: 'mentioned',
          by: 'Sam Support',
          where: 'reply',
          text: {
            text: 'Ask [@](mention:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b).',
            format: 'markdown',
            mentions: { '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b': 'Jane Tester' },
          },
        },
      ],
    });

    // What put the reader on the request, each in a sentence of its own.
    expect(email.text).toContain('Morgan Manager assigned this request to you.');
    expect(email.text).toContain('Anna Admin subscribed you to this request.');
    expect(email.text).toContain('Casey Client mentioned you in the description:');
    expect(email.text).toContain('Sam Support mentioned you in a reply:');
    expect(email.text).toContain('Ask @Jane Tester.');
    // The number and the title, the same for every email about the request.
    expect(email.subject).toBe('AD-142: The printer is broken');
    expect(email.text).toContain('Sam Support replied:');
    expect(email.html).toContain('<strong>plugged in</strong>');
    // The status in the reader's words, and the changes that have a sentence of their own.
    expect(email.text).toContain(
      'Sam Support changed the status from In progress to Waiting for your reply.',
    );
    expect(email.text).toContain('Casey Client marked this request as done.');
    expect(email.text).toContain('Casey Client reopened this request.');
    expect(email.text).toContain('you’re subscribed to this request');
    // The footer says where to stop them all: the account's card for them.
    expect(email.html).toContain(`href="${appUrl}/account/preferences#request-emails"`);
    expect(email.text).toContain(`your account ${appUrl}/account/preferences#request-emails`);
    expect(email.text).toContain('Replies to this email aren’t read.');
    // Its links sign the reader in, so it says not to forward it.
    expect(email.text).toContain(
      'The links in this email sign you in to Adiutor for 14 days, so don’t forward it.',
    );
    // An image someone wrote is a link, never loaded: the logo is the email's only image.
    expect(email.html.match(/<img /g)).toHaveLength(1);
    // The request comes before any link someone wrote in a reply.
    expectBasics(email, url);
  });

  it('names the files of a reply under it, with their sizes and without a link', async () => {
    const url = `${appUrl}/requests/142`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: 'Adiutor Tests',
      url,
      role: 'subscriber',
      audience: 'contributor',
      items: [
        {
          event: 'reply',
          by: 'Sam Support',
          text: {
            text: 'The test page is attached.',
            format: 'plain',
            mentions: {},
            attachments: [
              { name: 'test-page.pdf', size: 184_000 },
              { name: 'printer.log', size: 15 },
            ],
          },
        },
      ],
    });

    expect(email.text).toContain('2 files attached, to download from the request:');
    expect(email.text).toContain('test-page.pdf (184 kB)');
    expect(email.text).toContain('printer.log (15 bytes)');
    // Named only: nothing links to a file, and nothing is attached.
    expect(email.html).not.toContain('/attachments/');
    expectBasics(email, url);
  });

  it('tells someone a request was raised for, with its description in full', async () => {
    const url = `${appUrl}/requests/142#request-description`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: 'Adiutor Tests',
      url,
      role: 'subscriber',
      audience: 'contributor',
      items: [
        {
          event: 'raised',
          by: 'Sam Support',
          text: { text: 'It prints **blank** pages.', format: 'markdown', mentions: {} },
        },
      ],
    });

    expect(email.text).toContain('Sam Support raised this request for you:');
    expect(email.html).toContain('<strong>blank</strong>');
    expect(email.html).toContain('Sam Support raised this request for you.');
    expectBasics(email, url);
  });

  it('shows the staff an internal note in full, marked as one', async () => {
    const url = `${appUrl}/requests/142`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: 'Adiutor Tests',
      url,
      role: 'assignee',
      audience: 'staff',
      items: [
        {
          event: 'note',
          by: 'Sam Support',
          text: { text: 'The toner is **empty**.', format: 'markdown', mentions: {} },
        },
        {
          event: 'mentioned',
          by: 'Morgan Manager',
          where: 'note',
          text: { text: 'Ask Jane.', format: 'plain', mentions: {} },
        },
      ],
    });

    expect(email.text).toContain('Sam Support wrote an internal note:');
    expect(email.html).toContain('<strong>empty</strong>');
    expect(email.text).toContain('Morgan Manager mentioned you in an internal note:');
    expect(email.text.match(/Internal note: only the staff see this\./g)).toHaveLength(2);
    expectBasics(email, url);
  });

  it('asks someone at the company to approve or deny a solution, with links of their own', async () => {
    const url = `${appUrl}/requests/142`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: 'Adiutor Tests',
      url,
      role: 'subscriber',
      audience: 'contributor',
      items: [
        {
          event: 'reply',
          by: 'Sam Support',
          text: { text: 'The toner was empty.', format: 'plain', mentions: {} },
        },
        {
          event: 'status',
          by: 'Sam Support',
          bySide: 'staff',
          from: 'in_progress',
          to: 'proposed',
        },
      ],
      answerLinks: {
        approve: `${appUrl}/answer/t0k3n/approve`,
        deny: `${appUrl}/answer/t0k3n/deny`,
      },
    });

    expect(email.text).toContain('Sam Support proposed a solution.');
    expect(email.text).toContain('Does this solve your request?');
    // The two answers take the place of "Open request"; the request stays the first link.
    expect(email.html).toContain(`href="${appUrl}/answer/t0k3n/approve"`);
    expect(email.html).toContain(`href="${appUrl}/answer/t0k3n/deny"`);
    expect(email.text).toMatch(/Approve\s+https:\/\/\S+\/answer\/t0k3n\/approve/);
    expect(email.text).toMatch(/Deny\s+https:\/\/\S+\/answer\/t0k3n\/deny/);
    expect(email.text).not.toContain('Open request');
    expect(email.text).toContain('These buttons work only for you, and only once.');
    expectBasics(email, url);
  });

  it('says a request’s email is for its assignee, and escapes what people wrote', async () => {
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      reference: 'AD-142',
      title: '<b>Printer</b>',
      companyName: 'Adiutor Tests',
      url: `${appUrl}/requests/142`,
      role: 'assignee',
      audience: 'staff',
      items: [
        {
          event: 'reply',
          by: '<i>Casey</i>',
          text: { text: '<script>alert(1)</script>', format: 'markdown', mentions: {} },
        },
      ],
    });

    expect(email.text).toContain('this request is assigned to you');
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>Printer</b>');
    expect(email.html).not.toContain('<i>Casey</i>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('tells the staff Admins about a new staff Admin, and how they became one', async () => {
    const url = `${appUrl}/admin/settings/staff`;
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
    expect(made.text).toContain('remove their staff access in the staff settings');
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

    const reactivated = await staffAdminAddedEmail('alex@adiutor.test', {
      ...english,
      newAdminName: 'Sam Tester',
      newAdminEmail: 'sam@adiutor.test',
      how: 'reactivation',
      byName: 'Jane Admin',
      url,
    });
    expect(reactivated.subject).toBe('Sam Tester is now a staff Admin on Adiutor');
    expect(reactivated.text).toContain(
      'Jane Admin reactivated the account of Sam Tester (sam@adiutor.test), which is a staff Admin',
    );
    expectBasics(reactivated, url);
  });

  it('tries a mail server with a test email to the staff Admin saving it', async () => {
    const url = `${appUrl}/admin/settings/connections#mail-server`;
    const test = await smtpTestEmail('jane@adiutor.test', {
      ...english,
      server: 'smtp.adiutor.test:587',
      url,
    });
    expect(test.subject).toBe('Adiutor can send email through this mail server');
    expect(test.text).toContain('Adiutor sent this test email through smtp.adiutor.test:587');
    expect(test.text).toContain('saving a mail server on the Connections tab');
    expectBasics(test, url);
  });

  it('tells the other staff Admins who changed the mail server, and why it matters', async () => {
    const url = `${appUrl}/admin/settings/connections#mail-server`;
    const changed = await smtpChangedEmail('alex@adiutor.test', {
      ...english,
      server: 'smtp.adiutor.test:587',
      byName: 'Jane Admin',
      url,
    });
    expect(changed.subject).toBe('Adiutor sends email through another mail server');
    expect(changed.text).toContain(
      'Jane Admin changed the mail server Adiutor sends email through to smtp.adiutor.test:587.',
    );
    expect(changed.text).toContain('can read the sign-in links and codes Adiutor sends');
    expect(changed.text).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expectBasics(changed, url);

    const byNobody = await smtpChangedEmail('alex@adiutor.test', {
      ...english,
      server: 'smtp.adiutor.test:587',
      byName: null,
      url,
    });
    expect(byNobody.text).toContain(
      'The mail server Adiutor sends email through was changed to smtp.adiutor.test:587.',
    );
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

describe('webhooks', () => {
  const url = `${appUrl}/admin/settings/webhooks/019abcde-0000-7000-8000-000000000001`;

  it('tells a staff Admin which webhook was turned off and why, never its address', async () => {
    const failing = await webhookTurnedOffEmail('alex@adiutor.test', {
      ...english,
      name: 'Procurement',
      reason: 'failing',
      url,
    });
    expect(failing.subject).toBe('The webhook “Procurement” was turned off');
    expect(failing.text).toContain(
      'Every delivery to it has failed for 3 days, so it was turned off automatically.',
    );
    expect(failing.text).toContain('turn it on in Settings');
    expectBasics(failing, url);

    const gone = await webhookTurnedOffEmail('alex@adiutor.test', {
      ...english,
      name: 'Procurement',
      reason: 'gone',
      url,
    });
    expect(gone.text).toContain('gone for good (410 Gone)');

    const unreadable = await webhookTurnedOffEmail('alex@adiutor.test', {
      ...english,
      name: 'Procurement',
      reason: 'unreadable',
      url,
    });
    expect(unreadable.text).toContain('Enter its address again and renew its secret');
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

    expect(email.subject).toBe('Two-step verification was turned off for your account on Adiutor');
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

    expect(email.subject).toBe('GitHub was connected to your account on Adiutor');
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

    expect(email.subject).toBe('Password sign-in to your account on Adiutor is paused');
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

    expect(email.subject).toBe('Your account on Adiutor was deleted');
    expect(email.html).not.toContain('/account/security');
    expect(email.text).not.toContain('/account/security');
    expect(email.text).toContain("You can't sign in with it any more.");
    expect(email.text).toContain('contact your administrator');
    expect(email.text).toContain('because your account on Adiutor was deleted');
  });

  it('tells the owner that wrong codes paused signing in with a code, and to change the password', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'two_factor_locked',
      when,
    });

    expect(email.subject).toBe('Signing in to your account on Adiutor with a code is paused');
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

    expect(email.subject).toBe('Your two-step verification for Adiutor was reset');
    expect(email.text).toContain(
      'Any GitHub or Google accounts connected to your account were disconnected',
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
      brand: { colours: DEFAULT_EMAIL_COLOURS, name: 'Adiutor Tests' },
    });

    expect(email.subject).toBe('Sam Lee from Adiutor Tests signed in as you');
    expect(email.html).toContain('Sam Lee signed in as you');
    expect(email.text).toContain(
      "Sam Lee from Adiutor Tests signed in as you, to see what you see and check what isn't working.",
    );
    expect(email.text).toContain('because a staff member signed in to Adiutor Tests as you.');
    expect(email.text).toContain('It ends after at most 30 minutes.');
    expect(email.text).toContain('you can turn it off on your Security page.');
    expect(email.text).toContain("If you didn't expect this, contact your administrator.");
    expect(email.text).not.toContain('From:');
    // Straight to the switch for sign-ins by staff.
    expectBasics(email, `${appUrl}/account/security#staff-sign-in`, 'Adiutor Tests');
  });

  it('says "a staff member" when the notice is built without a name', async () => {
    const email = await securityNoticeEmail('jane@adiutor.test', {
      ...english,
      timeZone: 'UTC',
      kind: 'impersonation_started',
      when,
    });

    expect(email.subject).toBe('A staff member from Adiutor signed in as you');
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

/**
 * Builds one email of every template (security notices apart) in a language,
 * in a brand when one is given. The invitation emails come twice: to a
 * company, and to the staff, whose name is the staff's (the brand's, else
 * Adiutor's).
 */
const EVERY_TEMPLATE: Record<string, (locale: Locale, brand?: EmailBrand) => Promise<BuiltEmail>> =
  {
    /**
     * The sign-in link email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'magic link': async (locale, brand) => {
      const url = `${appUrl}/auth/email-link?token=abc`;
      return {
        email: await magicLinkEmail('jane@adiutor.test', { appUrl, locale, brand, url }),
        url,
      };
    },
    /**
     * The password reset email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'password reset': async (locale, brand) => {
      const url = `${appUrl}/auth/reset-password?token=abc`;
      return {
        email: await resetPasswordEmail('jane@adiutor.test', { appUrl, locale, brand, url }),
        url,
      };
    },
    /**
     * The email verification email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'email verification': async (locale, brand) => {
      const url = `${appUrl}/api/auth/verify-email?token=abc`;
      return {
        email: await verifyEmailEmail('jane@adiutor.test', { appUrl, locale, brand, url }),
        url,
      };
    },
    /**
     * The invitation.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    invitation: async (locale, brand) => {
      const url = `${appUrl}/invite/abc`;
      const email = await invitationEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        inviterName: 'Sam Doe',
        companyName: 'Adiutor Tests',
        target: 'company',
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
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'invitation reminder': async (locale, brand) => {
      const url = `${appUrl}/invite/abc`;
      const email = await invitationReminderEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        timeZone: 'UTC',
        inviterName: 'Sam Doe',
        companyName: 'Adiutor Tests',
        target: 'company',
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
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'invite-link confirmation': async (locale, brand) => {
      const url = `${appUrl}/invite/abc`;
      const email = await inviteLinkConfirmationEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        companyName: 'Adiutor Tests',
        target: 'company',
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
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'already a member': async (locale, brand) => {
      const url = `${appUrl}/companies/abc`;
      const email = await alreadyMemberEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        companyName: 'Adiutor Tests',
        target: 'company',
        url,
      });
      return { email, url };
    },
    /**
     * The "already invited" email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'already invited': async (locale, brand) => ({
      email: await alreadyInvitedEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        companyName: 'Adiutor Tests',
        target: 'company',
      }),
      url: `${appUrl}/auth`,
    }),
    /**
     * The invitation to the staff.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'invitation to the staff': async (locale, brand) => {
      const url = `${appUrl}/invite/abc`;
      const email = await invitationEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        inviterName: 'Sam Doe',
        companyName: emailName(brand),
        target: 'staff',
        role: 'manager',
        url,
        validDays: 7,
      });
      return { email, url };
    },
    /**
     * The reminder of an invitation to the staff.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'invitation reminder for the staff': async (locale, brand) => {
      const url = `${appUrl}/invite/abc`;
      const email = await invitationReminderEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        timeZone: 'UTC',
        inviterName: 'Sam Doe',
        companyName: emailName(brand),
        target: 'staff',
        role: 'support',
        url,
        expiresAt: new Date('2026-10-25T14:05:00Z'),
      });
      return { email, url };
    },
    /**
     * The confirmation of an invite link to the staff.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'invite-link confirmation for the staff': async (locale, brand) => {
      const url = `${appUrl}/invite/abc`;
      const email = await inviteLinkConfirmationEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        companyName: emailName(brand),
        target: 'staff',
        role: 'finance',
        url,
        validDays: 1,
      });
      return { email, url };
    },
    /**
     * The "already a member" email for someone already on the staff.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'already on the staff': async (locale, brand) => {
      const url = `${appUrl}/dashboard`;
      const email = await alreadyMemberEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        companyName: emailName(brand),
        target: 'staff',
        url,
      });
      return { email, url };
    },
    /**
     * The "already invited" email for an invitation to the staff.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'already invited to the staff': async (locale, brand) => ({
      email: await alreadyInvitedEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        companyName: emailName(brand),
        target: 'staff',
      }),
      url: `${appUrl}/auth`,
    }),
    /**
     * The reminder of an invitation to the staff whose sender's account is gone.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'invitation reminder without its sender': async (locale, brand) => {
      const url = `${appUrl}/invite/abc`;
      const email = await invitationReminderEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        timeZone: 'UTC',
        inviterName: null,
        companyName: emailName(brand),
        target: 'staff',
        role: 'manager',
        url,
        expiresAt: new Date('2026-10-25T14:05:00Z'),
      });
      return { email, url };
    },
    /**
     * The "added to a company" email when the account of whoever added them is gone.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'added to a company by someone gone': async (locale, brand) => {
      const url = `${appUrl}/companies/abc`;
      const email = await addedToCompanyEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        adderName: null,
        companyName: 'Adiutor Tests',
        role: 'client',
        url,
      });
      return { email, url };
    },
    /**
     * The welcome email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'account created': async (locale, brand) => {
      const url = `${appUrl}/auth/reset-password?token=abc`;
      const email = await accountCreatedEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        creatorName: 'Alex Admin',
        url,
        validDays: 7,
      });
      return { email, url };
    },
    /**
     * The "added to a company" email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'added to a company': async (locale, brand) => {
      const url = `${appUrl}/companies/abc`;
      const email = await addedToCompanyEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        adderName: 'Alex Admin',
        companyName: 'Adiutor Tests',
        role: 'client',
        url,
      });
      return { email, url };
    },
    /**
     * The email about what happened to a request.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'news about a request': async (locale, brand) => {
      const url = `${appUrl}/requests/142`;
      const email = await requestUpdateEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        reference: 'AD-142',
        title: 'Adiutor Tests',
        companyName: 'Adiutor Tests',
        url,
        role: 'subscriber',
        audience: 'follower',
        items: [
          {
            event: 'reply',
            by: 'Sam Support',
            text: {
              text: 'https://adiutor.test/manual',
              format: 'markdown',
              mentions: {},
              attachments: [{ name: 'Adiutor Tests.pdf', size: 184_000 }],
            },
          },
          { event: 'status', by: 'Sam Support', bySide: 'staff', from: 'open', to: 'waiting' },
          {
            event: 'note',
            by: 'Sam Support',
            text: { text: 'Adiutor Tests', format: 'plain', mentions: {} },
          },
          { event: 'assigned', by: 'Sam Support' },
          { event: 'subscribed', by: 'Sam Support' },
          {
            event: 'mentioned',
            by: 'Sam Support',
            where: 'description',
            text: { text: 'Adiutor Tests', format: 'plain', mentions: {} },
          },
          {
            event: 'raised',
            by: 'Sam Support',
            text: { text: 'Adiutor Tests', format: 'plain', mentions: {} },
          },
        ],
      });
      return { email, url };
    },
    /**
     * The email about a solution, to someone who may answer it.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'a solution to answer': async (locale, brand) => {
      const url = `${appUrl}/requests/142`;
      const email = await requestUpdateEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        reference: 'AD-142',
        title: 'Adiutor Tests',
        companyName: 'Adiutor Tests',
        url,
        role: 'subscriber',
        audience: 'contributor',
        items: [
          {
            event: 'status',
            by: 'Sam Support',
            bySide: 'staff',
            from: 'in_progress',
            to: 'proposed',
          },
        ],
        answerLinks: {
          approve: `${appUrl}/answer/t0k3n/approve`,
          deny: `${appUrl}/answer/t0k3n/deny`,
        },
      });
      return { email, url };
    },
    /**
     * The "job keeps failing" email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'job keeps failing': async (locale, brand) => {
      const url = `${appUrl}/admin/logs/errors?q=7KQ2-M9XD`;
      const email = await jobFailingEmail('alex@adiutor.test', {
        appUrl,
        locale,
        brand,
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
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'new staff Admin': async (locale, brand) => {
      const url = `${appUrl}/admin/settings/staff`;
      const email = await staffAdminAddedEmail('alex@adiutor.test', {
        appUrl,
        locale,
        brand,
        newAdminName: 'Sam Tester',
        newAdminEmail: 'sam@adiutor.test',
        how: 'invitation',
        byName: 'Jane Admin',
        url,
      });
      return { email, url };
    },
    /**
     * The "a webhook was turned off" email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'a webhook turned off': async (locale, brand) => {
      const url = `${appUrl}/admin/settings/webhooks/019abcde-0000-7000-8000-000000000001`;
      const email = await webhookTurnedOffEmail('alex@adiutor.test', {
        appUrl,
        locale,
        brand,
        name: 'Procurement',
        reason: 'failing',
        url,
      });
      return { email, url };
    },
    /**
     * The mail server's test email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'mail server test': async (locale, brand) => {
      const url = `${appUrl}/admin/settings/connections#mail-server`;
      const email = await smtpTestEmail('jane@adiutor.test', {
        appUrl,
        locale,
        brand,
        server: 'smtp.adiutor.test:587',
        url,
      });
      return { email, url };
    },
    /**
     * The "the mail server changed" email.
     *
     * @param locale - The language.
     * @param brand - The brand, if any.
     * @returns The email and its main link.
     */
    'mail server changed': async (locale, brand) => {
      const url = `${appUrl}/admin/settings/connections#mail-server`;
      const email = await smtpChangedEmail('alex@adiutor.test', {
        appUrl,
        locale,
        brand,
        server: 'smtp.adiutor.test:587',
        byName: 'Jane Admin',
        url,
      });
      return { email, url };
    },
  };

/**
 * The templates whose subject has no words of its own to translate: an email
 * about a request has the request's number and title, the same in every
 * language, so mail apps keep the emails about one request together.
 */
const SUBJECTS_WITHOUT_WORDS: readonly string[] = ['news about a request', 'a solution to answer'];

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
      if (SUBJECTS_WITHOUT_WORDS.includes(name)) {
        expect(email.subject).toBe(inEnglish.subject);
      } else {
        expect(email.subject).not.toBe(inEnglish.subject);
      }
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
      target: 'company',
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
      target: 'company',
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
      target: 'company',
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
      target: 'company',
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

/** "Powered by Adiutor" in each language: the footer's last line once the staff have a name. */
const POWERED_BY: Record<Locale, string> = {
  'en-US': 'Powered by Adiutor',
  'nl-NL': 'Mogelijk gemaakt door Adiutor',
  'es-ES': 'Con la tecnología de Adiutor',
};

/**
 * The words that must never come right before the staff's name, per
 * language: an article or a possessive, which would read oddly with a name
 * like "The Service Desk".
 */
const BEFORE_THE_NAME: Record<Locale, RegExp> = {
  'en-US': /\b(?:a|an|the|your)\s+Acme Support/i,
  'nl-NL': /\b(?:een|de|het|je|jouw)\s+Acme Support/i,
  'es-ES': /\b(?:un|una|el|la|los|las|tu)\s+Acme Support/i,
};

/**
 * Builds one security notice of a kind, with every name it can show.
 *
 * @param locale - The language.
 * @param kind - What changed.
 * @param brand - The brand, if any.
 * @returns The email.
 */
function everyNotice(locale: Locale, kind: SecurityNoticeKind, brand?: EmailBrand) {
  return securityNoticeEmail('jane@adiutor.test', {
    appUrl,
    locale,
    brand,
    kind,
    when: new Date('2026-10-23T14:05:00Z'),
    timeZone: 'UTC',
    provider: 'GitHub',
    role: 'client',
    company: 'Adiutor Tests',
    staffMember: 'Sam Lee',
  });
}

describe('the staff’s name', () => {
  /** A staff with a name of their own, which reads like a team's. */
  const acme: EmailBrand = { colours: DEFAULT_EMAIL_COLOURS, name: 'Acme Support' };
  /** The brand before setup names the staff: Adiutor's own name. */
  const own: EmailBrand = { colours: DEFAULT_EMAIL_COLOURS, name: 'Adiutor' };

  /** Every email, as `[locale, name, build]`: every template and every security notice. */
  const emails = LOCALES.flatMap((locale) => [
    ...Object.entries(EVERY_TEMPLATE).map(
      ([name, build]) =>
        [locale, name, async (brand?: EmailBrand) => (await build(locale, brand)).email] as const,
    ),
    ...SECURITY_NOTICE_KINDS.map(
      (kind) =>
        [
          locale,
          `the ${kind} notice`,
          (brand?: EmailBrand) => everyNotice(locale, kind, brand),
        ] as const,
    ),
  ]);

  it.each(emails)(
    '%s: %s names the staff instead of Adiutor, which only says it powers it',
    async (locale, _name, build) => {
      const email = await build(acme);
      const subjectAndText = `${email.subject}\n${email.text}`;
      /**
       * What the email says in its own words: without the footer's "Powered by
       * Adiutor" and the test data, whose company is "Adiutor Tests".
       *
       * @param part - The subject, HTML or plain text.
       * @returns The part without them.
       */
      const ownWords = (part: string) =>
        part.replaceAll(POWERED_BY[locale], '').replaceAll('Adiutor Tests', '');

      expect(ownWords(email.subject)).not.toContain('Adiutor');
      expect(ownWords(email.html)).not.toContain('Adiutor');
      expect(ownWords(email.text)).not.toContain('Adiutor');
      expect(email.html).toContain('alt="Acme Support"');
      expect(email.html).toContain('>Acme Support</a>');
      // Once, at the end of the footer, in the plain text too.
      expect(email.html.split(POWERED_BY[locale])).toHaveLength(2);
      expect(email.text.split(POWERED_BY[locale])).toHaveLength(2);
      expect(email.text.trimEnd().endsWith(POWERED_BY[locale])).toBe(true);
      // Never twice in a sentence ("join Acme Support on Acme Support"), never after an article,
      // never as part of a word ("Acme Support-account").
      for (const sentence of subjectAndText.split(/(?<=[.!?:])\s+|\n+/)) {
        expect(sentence.split('Acme Support').length).toBeLessThanOrEqual(2);
      }
      expect(subjectAndText).not.toMatch(BEFORE_THE_NAME[locale]);
      expect(subjectAndText).not.toMatch(/Acme Support(?:-\w|['’]s\b)/);
    },
  );

  it.each(emails)(
    '%s: %s reads the same with Adiutor’s own name as without a brand',
    async (locale, _name, build) => {
      const [withoutBrand, withOwnName] = await Promise.all([build(), build(own)]);

      expect(withOwnName).toEqual(withoutBrand);
      expect(withoutBrand.html).not.toContain(POWERED_BY[locale]);
      expect(withoutBrand.text).not.toContain(POWERED_BY[locale]);
      expect(withoutBrand.html).toContain('alt="Adiutor"');
    },
  );

  it.each(emails)(
    '%s: %s links the logo a staff Admin uploaded, at its size, instead of Adiutor’s',
    async (_locale, _name, build) => {
      const email = await build({
        ...acme,
        logo: { src: '/branding/logo?v=logo-1', width: 560, height: 160 },
      });

      const logo = /<img[^>]*\/branding\/logo[^>]*>/.exec(email.html)?.[0] ?? '';
      expect(logo).toContain(`src="${appUrl}/branding/logo?v=logo-1"`);
      expect(logo).toContain('width="112"');
      expect(logo).toContain('height="32"');
      expect(email.html).toContain('alt="Acme Support"');
      expect(email.html).not.toContain('/brand/logo.png');
      expect(email.text).not.toContain('/branding/logo');
    },
  );

  it('names nobody in a sender’s place when their account is gone, so the staff’s name shows once', async () => {
    const [reminder, added] = await Promise.all([
      invitationReminderEmail('jane@adiutor.test', {
        ...english,
        brand: acme,
        timeZone: 'UTC',
        inviterName: null,
        companyName: 'Acme Support',
        target: 'staff',
        role: 'manager',
        url: `${appUrl}/invite/abc`,
        expiresAt: new Date('2026-10-25T14:05:00Z'),
      }),
      addedToCompanyEmail('jane@adiutor.test', {
        ...english,
        brand: acme,
        adderName: null,
        companyName: 'Adiutor Tests',
        role: 'client',
        url: `${appUrl}/companies/abc`,
      }),
    ]);

    expect(reminder.text).toContain(
      "You're invited to join Acme Support as Manager. The invitation is still open until Oct 25, 2026, 2:05 PM UTC.",
    );
    expect(reminder.text).toContain(
      "You're receiving this because this email address was invited to Acme Support and the invitation hasn't been accepted yet.",
    );
    expect(added.text).toContain('You were added to Adiutor Tests on Acme Support as Client.');
    expect(added.text).toContain(
      "You're receiving this because your account was added to Adiutor Tests.",
    );
    for (const email of [reminder, added]) {
      expect(email.text).not.toMatch(/Acme Support (?:invited|added)/);
      for (const sentence of `${email.subject}\n${email.text}`.split(/(?<=[.!?:])\s+|\n+/)) {
        expect(sentence.split('Acme Support').length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('request emails: links to the staff’s pages', () => {
  it('shows a link to one as its text in a reply, and keeps it in an internal note', async () => {
    const url = `${appUrl}/requests/142`;
    const userPage = `${appUrl}/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b`;
    const written = `Ask [Sam Support](${userPage}).`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: 'Adiutor Tests',
      url,
      role: 'assignee',
      audience: 'staff',
      items: [
        {
          event: 'reply',
          by: 'Casey Client',
          text: { text: written, format: 'markdown', mentions: {} },
        },
        {
          event: 'mentioned',
          by: 'Casey Client',
          where: 'reply',
          text: { text: written, format: 'markdown', mentions: {} },
        },
        {
          event: 'note',
          by: 'Morgan Manager',
          text: { text: written, format: 'markdown', mentions: {} },
        },
      ],
    });

    // Only the note links to the user's page, also in the plain text, which shows its address.
    expect(email.html.match(new RegExp(`href="${userPage}"`, 'g'))).toHaveLength(1);
    expect(email.text.split(userPage)).toHaveLength(2);
    expect(email.text.match(/Ask Sam Support\./g)).toHaveLength(2);
    expectBasics(email, url);
  });

  it('keeps a link to one in an internal request’s reply, which only the staff read', async () => {
    const url = `${appUrl}/requests/142`;
    const userPage = `${appUrl}/admin/users/019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b`;
    const props = {
      ...english,
      reference: 'AD-142',
      title: 'The printer is broken',
      url,
      role: 'assignee',
      audience: 'staff',
      items: [
        {
          event: 'reply',
          by: 'Morgan Manager',
          text: { text: `Ask [Sam Support](${userPage}).`, format: 'markdown', mentions: {} },
        },
      ],
    } as const;

    const internal = await requestUpdateEmail('jane@adiutor.test', {
      ...props,
      companyName: null,
    });
    const inCompany = await requestUpdateEmail('jane@adiutor.test', {
      ...props,
      companyName: 'Adiutor Tests',
    });

    expect(internal.html).toContain(`href="${userPage}"`);
    expect(inCompany.html).not.toContain(`href="${userPage}"`);
    expectBasics(internal, url);
  });
});

describe('request emails: an internal request', () => {
  it.each([
    ['en-US', 'AD-142 · Internal'],
    ['nl-NL', 'AD-142 · Intern'],
    ['es-ES', 'AD-142 · Interna'],
  ] as const)('%s: says Internal where the company would be', async (locale, where) => {
    const url = `${appUrl}/requests/142`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      appUrl,
      locale,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: null,
      url,
      role: 'assignee',
      audience: 'staff',
      items: [{ event: 'assigned', by: 'Sam Support' }],
    });

    // The reference is the link in the HTML, so the label follows its closing tag.
    expect(email.html).toMatch(new RegExp(`AD-142</a> · ${where.split('· ')[1]}`));
    // In the plain text the reference is followed by its link.
    expect(email.text).toMatch(new RegExp(`AD-142 \\S+ · ${where.split('· ')[1]}`));
    expect(email.text).not.toMatch(/[{}]/);
    expect(email.text.match(/https?:\/\/\S+/)?.[0]).toBe(url);
    expectBasics(email, url);
  });
});

describe('brand colours', () => {
  /** A brand whose colours differ from the theme's in every colour that matters. */
  const brand: EmailBrand = {
    colours: emailColoursOf(
      derivePalette({ accent: '#c2185b', accentDark: null, tint: '#2e7d32' }),
    ),
    name: 'Adiutor',
  };

  it('draws the page, the button and the links in the brand’s colours', async () => {
    const url = `${appUrl}/api/auth/request-link/sign-in?token=adiutor-tests-token`;
    const email = await requestUpdateEmail('jane@adiutor.test', {
      ...english,
      brand,
      reference: 'AD-142',
      title: 'The printer is broken',
      companyName: 'Adiutor Tests',
      url,
      role: 'subscriber',
      audience: 'contributor',
      items: [
        {
          event: 'reply',
          by: 'Sam Support',
          text: { text: 'See https://adiutor.test/manual.', format: 'markdown', mentions: {} },
        },
      ],
    });

    expect(brand.colours.primary).not.toBe(DEFAULT_EMAIL_COLOURS.primary);
    expect(email.html).toContain(`background-color:${brand.colours.background}`);
    expect(email.html).toContain(`background-color:${brand.colours.primary}`);
    expect(email.html).toContain(
      `color:${brand.colours.primary};text-decoration-line:none;font-weight:600`,
    );
    expect(email.html).toContain(`color:${brand.colours.primary};text-decoration:underline`);
    expect(email.html).not.toContain(DEFAULT_EMAIL_COLOURS.primary);
    expect(email.html).not.toContain(DEFAULT_EMAIL_COLOURS.background);
  });

  it('draws the code box and the role summary in the brand’s colours', async () => {
    const [code, invitation] = await Promise.all([
      twoFactorCodeEmail('jane@adiutor.test', { ...english, brand, code: '482915' }),
      invitationEmail('jane@adiutor.test', {
        ...english,
        brand,
        inviterName: 'Sam Doe',
        companyName: 'Adiutor Tests',
        target: 'company',
        role: 'client',
        url: `${appUrl}/invite/abc`,
        validDays: 7,
      }),
    ]);

    for (const email of [code, invitation]) {
      expect(email.html).toContain(`border:1px solid ${brand.colours.border}`);
      expect(email.html).not.toContain(DEFAULT_EMAIL_COLOURS.border);
    }
  });

  it('keeps the theme’s colours without a brand', async () => {
    const email = await magicLinkEmail('jane@adiutor.test', {
      ...english,
      url: `${appUrl}/auth/email-link?token=abc`,
    });
    const withDefaults = await magicLinkEmail('jane@adiutor.test', {
      ...english,
      brand: { colours: DEFAULT_EMAIL_COLOURS, name: 'Adiutor' },
      url: `${appUrl}/auth/email-link?token=abc`,
    });

    expect(email.html).toContain('background-color:#0e5655');
    expect(email.html).toContain('background-color:#f7f7f9');
    expect(withDefaults.html).toBe(email.html);
  });
});
