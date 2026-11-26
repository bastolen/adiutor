/**
 * @file Integration tests for the Email tab of Settings: what it shows,
 * saving a mail server (tried with a test email to the staff Admin first,
 * the password encrypted and kept only for its server, refused while the
 * environment chooses, with a confirmation, a limit and an audit event), and
 * telling every staff Admin: through the previous mail server, or queued,
 * both emails in the brand colours.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { emailColoursOf } from '@/components/email/theme';
import { setting } from '@/db/schema';
import { derivePalette } from '@/lib/branding';
import type { Email } from '@/lib/email';
import type { SmtpConfig } from '@/lib/smtp';

import {
  auditEvents,
  createStaffSettings,
  fillRateLimitBucket,
  queuedJobKinds,
  saveSettings,
  setupTestContext,
  staffActor,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { ServiceError } from '../errors';
import { RATE_LIMITS } from '../rate-limit';
import { openSecret } from '../sealed-secrets';
import { getSmtpSettings, saveSmtpSettings } from './settings';

const { ctx, db } = setupTestContext();

/** An environment that chooses nothing, so Settings decides. */
const SETTINGS_DECIDE = {};

/** The Email tab's form, as a browser sends it. */
const FORM = {
  host: 'smtp.adiutor.test',
  port: '587',
  security: 'starttls',
  username: 'mailer@adiutor.test',
  password: 'secret-password',
  fromName: 'Adiutor Tests',
  fromAddress: 'no-reply@adiutor.test',
};

/** A staff Admin without a second step, so nothing needs a recent confirmation. */
let admin: Actor;

/** The emails each test's fake `sendThrough` was given, with the mail server they went through. */
let tried: { config: SmtpConfig; email: Email }[];

/** Mail servers the fake `sendThrough` fails for, by host, with the error it throws. */
let failing: Map<string, Error>;

/**
 * A fake `sendThrough`: keeps what it was given, and fails for the hosts in {@link failing}.
 *
 * @param config - The mail server.
 * @param email - The email.
 */
async function send(config: SmtpConfig, email: Email): Promise<void> {
  const failure = failing.get(config.host);
  if (failure) {
    throw failure;
  }
  tried.push({ config, email });
}

beforeEach(async () => {
  await createStaffSettings(db);
  admin = await staffActor(db, 'platform_admin', 'jane@adiutor.test');
  tried = [];
  failing = new Map();
});

/**
 * The mail server as Settings keeps it.
 *
 * @returns Its stored value.
 */
async function storedSmtp(): Promise<SmtpConfig | null> {
  const [row] = await db.select().from(setting).where(eq(setting.key, 'email.smtp'));
  return (row?.value as SmtpConfig | undefined) ?? null;
}

/**
 * The service error a call fails with.
 *
 * @param work - The call.
 * @returns The error.
 */
async function refusal(work: () => Promise<unknown>): Promise<ServiceError> {
  const error = await work().then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof ServiceError)) {
    throw new Error(`Expected a service error, got ${String(error)}.`);
  }
  return error;
}

describe('saveSmtpSettings', () => {
  it('tries the mail server with a test email to the staff Admin, then saves it encrypted', async () => {
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);

    expect(tried).toHaveLength(1);
    const [test] = tried;
    expect(test?.email.to).toBe('jane@adiutor.test');
    expect(test?.email.subject).toBe('Adiutor Tests can send email through this mail server');
    expect(test?.config).toEqual({
      host: 'smtp.adiutor.test',
      port: 587,
      security: 'starttls',
      username: 'mailer@adiutor.test',
      password: 'secret-password',
      from: { name: 'Adiutor Tests', address: 'no-reply@adiutor.test' },
    });

    const stored = await storedSmtp();
    expect(stored).toMatchObject({ host: 'smtp.adiutor.test', port: 587, security: 'starttls' });
    expect(stored?.password).not.toBe('secret-password');
    expect(await openSecret(stored?.password ?? '')).toBe('secret-password');
    expect(JSON.stringify(stored)).not.toContain('secret-password');
  });

  it('records the change in the audit log, without the username or the password', async () => {
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);

    const [event] = await auditEvents(db, { action: 'smtp_settings_changed' });
    expect(event).toMatchObject({
      actorUserId: admin.id,
      details: { staff: true, server: 'smtp.adiutor.test:587' },
    });
    expect(JSON.stringify(event)).not.toMatch(/secret-password|mailer@adiutor\.test/);
  });

  it('saves nothing when the test fails, and names only the kind of failure', async () => {
    failing.set(
      'smtp.adiutor.test',
      Object.assign(new Error('535 5.7.8 Authentication failed for mailer@adiutor.test'), {
        code: 'EAUTH',
      }),
    );

    const error = await refusal(() => saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send));

    expect(error).toMatchObject({ code: 'invalid', key: 'errors.email.check.loginRefused' });
    expect(await storedSmtp()).toBeNull();
    expect(await auditEvents(db, { action: 'smtp_settings_changed' })).toEqual([]);
  });

  it('keeps the saved password for the same server, port and username only', async () => {
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);

    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, password: '', fromName: 'Helpdesk' },
      SETTINGS_DECIDE,
      send,
    );
    expect(tried.at(-1)?.config.password).toBe('secret-password');

    /**
     * Saves with the password left empty and one field changed.
     *
     * @param changed - The changed field.
     * @returns The refusal.
     */
    const withoutPassword = (changed: Partial<typeof FORM>) =>
      refusal(() =>
        saveSmtpSettings(ctx, admin, { ...FORM, ...changed, password: '' }, SETTINGS_DECIDE, send),
      );
    const needed = { code: 'invalid', key: 'errors.email.passwordNeeded' };
    expect(await withoutPassword({ host: 'smtp2.adiutor.test' })).toMatchObject(needed);
    // Another security, on the same port: a saved password is never sent without its encryption.
    expect(await withoutPassword({ security: 'none' })).toMatchObject(needed);
    expect(await withoutPassword({ port: '465' })).toMatchObject(needed);
    expect(await withoutPassword({ username: 'other@adiutor.test' })).toMatchObject(needed);
  });

  it('signs in to no server without a username, and keeps no password then', async () => {
    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, username: '', password: 'ignored' },
      SETTINGS_DECIDE,
      send,
    );

    expect(tried[0]?.config).toMatchObject({ username: null, password: null });
    expect((await storedSmtp())?.password).toBeNull();
  });

  it('asks for the sender’s address unless EMAIL_FROM chooses the sender', async () => {
    const error = await refusal(() =>
      saveSmtpSettings(ctx, admin, { ...FORM, fromAddress: null }, SETTINGS_DECIDE, send),
    );
    expect(error).toMatchObject({ code: 'invalid', key: 'errors.email.senderNeeded' });

    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, fromName: '', fromAddress: null },
      { EMAIL_FROM: 'Adiutor <mail@adiutor.test>' },
      send,
    );
    expect((await storedSmtp())?.from).toEqual({
      name: 'Adiutor',
      address: 'no-reply@adiutor.dev',
    });
  });

  it('asks production for a secured connection, except to a server on this computer', async () => {
    const production = { NODE_ENV: 'production' };

    const error = await refusal(() =>
      saveSmtpSettings(ctx, admin, { ...FORM, security: 'none' }, production, send),
    );
    expect(error).toMatchObject({ code: 'invalid', key: 'errors.email.problem.tlsRequired' });
    expect(tried).toEqual([]);

    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, host: 'localhost', port: '1025', security: 'none', username: '' },
      production,
      send,
    );
    expect((await storedSmtp())?.host).toBe('localhost');
  });

  it('is refused while the environment chooses the mail server', async () => {
    const error = await refusal(() =>
      saveSmtpSettings(ctx, admin, FORM, { SMTP_URL: 'smtps://smtp.adiutor.test:465' }, send),
    );

    expect(error).toMatchObject({ code: 'conflict', key: 'errors.email.serverFromEnvironment' });
    expect(tried).toEqual([]);
  });

  it('needs a recent confirmation once the staff Admin has a second step', async () => {
    const unconfirmed = { ...admin, canConfirmSessions: true, mfaConfirmedUntil: null };

    const error = await refusal(() =>
      saveSmtpSettings(ctx, unconfirmed, FORM, SETTINGS_DECIDE, send),
    );
    expect(error).toMatchObject({
      code: 'confirmation_required',
      key: 'errors.email.confirmationRequired',
    });
    expect(tried).toEqual([]);

    const confirmed = { ...unconfirmed, mfaConfirmedUntil: new Date(Date.now() + 60_000) };
    await saveSmtpSettings(ctx, confirmed, FORM, SETTINGS_DECIDE, send);
    expect(tried).toHaveLength(1);
  });

  it('limits how many mail servers a staff Admin tries', async () => {
    await fillRateLimitBucket(db, `smtp-test:user:${admin.id}`, RATE_LIMITS.smtpTestsPerUser.limit);

    const error = await refusal(() => saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send));

    expect(error.code).toBe('rate_limited');
    expect(tried).toEqual([]);
  });

  it('refuses a form that doesn’t hold', async () => {
    await expect(
      saveSmtpSettings(ctx, admin, { ...FORM, host: 'not a host' }, SETTINGS_DECIDE, send),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe('telling the staff Admins', () => {
  it('tells every staff Admin through the mail server in use before, the one who saved too', async () => {
    await staffActor(db, 'platform_admin', 'sam@adiutor.test');
    await staffActor(db, 'manager', 'max@adiutor.test');
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);
    // There was no mail server before this first one, so its notices were queued.
    expect(await queuedJobKinds(db)).toEqual(['smtp-changed', 'smtp-changed']);
    tried = [];

    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, host: 'smtp2.adiutor.test', password: 'other-password' },
      SETTINGS_DECIDE,
      send,
    );

    // The test email through the new server, then a notice to each staff Admin through the old one
    // (never to the Manager).
    expect(tried[0]).toMatchObject({
      config: { host: 'smtp2.adiutor.test' },
      email: { to: 'jane@adiutor.test' },
    });
    const notices = tried.slice(1);
    expect(notices.map(({ email }) => email.to).sort()).toEqual([
      'jane@adiutor.test',
      'sam@adiutor.test',
    ]);
    notices.forEach(({ config, email }) => {
      expect(config).toMatchObject({ host: 'smtp.adiutor.test', password: 'secret-password' });
      expect(email.subject).toBe('Adiutor Tests sends email through another mail server');
      expect(email.text).toContain(
        `${admin.name} changed the mail server Adiutor Tests sends email through to smtp2.adiutor.test:587.`,
      );
    });
    // Nothing more was queued: they went out through the previous mail server.
    expect(await queuedJobKinds(db)).toHaveLength(2);
  });

  it('tells a lone staff Admin, through the previous mail server, of their own change', async () => {
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);
    tried = [];

    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, host: 'smtp2.adiutor.test', password: 'other-password' },
      SETTINGS_DECIDE,
      send,
    );

    expect(tried.map(({ config, email }) => [config.host, email.to, email.subject])).toEqual([
      [
        'smtp2.adiutor.test',
        'jane@adiutor.test',
        'Adiutor Tests can send email through this mail server',
      ],
      [
        'smtp.adiutor.test',
        'jane@adiutor.test',
        'Adiutor Tests sends email through another mail server',
      ],
    ]);
  });

  it('queues the rest once the previous mail server fails, and all when there was none', async () => {
    await staffActor(db, 'platform_admin', 'sam@adiutor.test');

    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);
    expect(await queuedJobKinds(db)).toHaveLength(2);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failing.set('smtp.adiutor.test', Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    tried = [];
    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, host: 'smtp2.adiutor.test', password: 'other-password' },
      SETTINGS_DECIDE,
      send,
    );

    // Only the test email went out: the previous server failed for the first notice, so it wasn't
    // tried again for the second, and both were queued.
    expect(tried).toHaveLength(1);
    expect(await queuedJobKinds(db)).toHaveLength(4);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.any(String), 'timedOut');
    warn.mockRestore();
  });

  it('sends the test email and the notice in the brand colours', async () => {
    await saveSettings(db, { 'brand.accent': '#c2185b' });
    const { primary } = emailColoursOf(
      derivePalette({ accent: '#c2185b', accentDark: null, tint: null }),
    );
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);
    tried = [];

    await saveSmtpSettings(
      ctx,
      admin,
      { ...FORM, host: 'smtp2.adiutor.test', password: 'other-password' },
      SETTINGS_DECIDE,
      send,
    );

    expect(tried.map(({ email }) => email.subject)).toEqual([
      'Adiutor Tests can send email through this mail server',
      'Adiutor Tests sends email through another mail server',
    ]);
    tried.forEach(({ email }) => {
      expect(email.html).toContain(`background-color:${primary}`);
    });
  });
});

describe('getSmtpSettings', () => {
  it('shows the saved mail server without its password', async () => {
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);

    const settings = await getSmtpSettings(ctx, admin, SETTINGS_DECIDE);

    expect(settings).toEqual({
      server: {
        source: 'settings',
        view: {
          host: 'smtp.adiutor.test',
          port: 587,
          security: 'starttls',
          username: 'mailer@adiutor.test',
          hasPassword: true,
          from: { name: 'Adiutor Tests', address: 'no-reply@adiutor.test' },
        },
      },
      environmentSender: null,
      senderInUse: 'Adiutor Tests <no-reply@adiutor.test>',
      production: false,
    });
  });

  it('shows the environment’s mail server and sender, never its password', async () => {
    await saveSmtpSettings(ctx, admin, FORM, SETTINGS_DECIDE, send);

    const settings = await getSmtpSettings(ctx, admin, {
      SMTP_URL: 'smtps://mailer:env-secret@smtp.adiutor.test:465',
      EMAIL_FROM: 'Adiutor <mail@adiutor.test>',
      NODE_ENV: 'production',
    });

    expect(settings).toEqual({
      server: {
        source: 'environment',
        view: {
          host: 'smtp.adiutor.test',
          port: 465,
          security: 'tls',
          username: 'mailer',
          hasPassword: true,
        },
      },
      environmentSender: 'Adiutor <mail@adiutor.test>',
      senderInUse: 'Adiutor <mail@adiutor.test>',
      production: true,
    });
    expect(JSON.stringify(settings)).not.toContain('env-secret');
  });

  it('is for staff Admins only', async () => {
    const manager = await staffActor(db, 'manager');

    const error = await refusal(() => getSmtpSettings(ctx, manager, SETTINGS_DECIDE));

    expect(error.code).toBe('forbidden');
  });
});
