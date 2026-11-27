/**
 * @file Tests for sending through the mail server saved on the mail server card of
 * Settings, when the environment names none: its sender and decrypted
 * password, its transport kept until the setting changes, the fallback
 * without one, and one email through a given server (`sendThrough`).
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmtpConfig } from './smtp';

/** The mocked transports, each with its options, its sends and whether it was closed. */
const mocks = vi.hoisted(() => {
  const transports: {
    options: Record<string, unknown>;
    sendMail: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    transports,
    createTransport: vi.fn((options: Record<string, unknown>) => {
      const transport = { options, sendMail: vi.fn().mockResolvedValue({}), close: vi.fn() };
      transports.push(transport);
      return transport;
    }),
    env: { NODE_ENV: 'production', EMAIL_FROM: undefined as string | undefined },
    saved: { current: null as SmtpConfig | null },
  };
});

vi.mock('nodemailer', () => ({ createTransport: mocks.createTransport }));
vi.mock('./env', () => ({ env: mocks.env }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/server/settings', () => ({
  /**
   * The saved mail server the test set.
   *
   * @returns The setting.
   */
  readSettings: async () => ({ 'email.smtp': mocks.saved.current }),
}));
vi.mock('@/server/sealed-secrets', () => ({
  /**
   * "Decrypts" a test's sealed text.
   *
   * @param sealed - The sealed text.
   * @returns The secret.
   */
  openSecret: async (sealed: string) => sealed.replace(/^sealed:/, ''),
}));

/** A mail server as Settings keeps it, its password "encrypted". */
const SAVED: SmtpConfig = {
  host: 'smtp.adiutor.test',
  port: 587,
  security: 'starttls',
  username: 'mailer@adiutor.test',
  password: 'sealed:secret-password',
  from: { name: 'Adiutor Tests', address: 'no-reply@adiutor.test' },
};

/** An email to send in the tests. */
const EMAIL = {
  to: 'jane@adiutor.test',
  subject: 'Your Adiutor sign-in link',
  text: 'Sign in https://adiutor.test/x',
  html: '<p>Sign in</p>',
};

beforeEach(() => {
  vi.resetModules();
  mocks.transports.length = 0;
  mocks.createTransport.mockClear();
  mocks.env.NODE_ENV = 'production';
  mocks.env.EMAIL_FROM = undefined;
  mocks.saved.current = SAVED;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendEmail with a mail server saved in Settings', () => {
  it('sends through it, signed in with its decrypted password, from its sender', async () => {
    const { sendEmail } = await import('./email');

    await sendEmail(EMAIL);

    const [transport] = mocks.transports;
    expect(transport?.options).toMatchObject({
      host: 'smtp.adiutor.test',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'mailer@adiutor.test', pass: 'secret-password' },
      pool: true,
    });
    expect(transport?.sendMail).toHaveBeenCalledWith({
      from: 'Adiutor Tests <no-reply@adiutor.test>',
      ...EMAIL,
    });
  });

  it('sends from EMAIL_FROM when the environment names a sender', async () => {
    mocks.env.EMAIL_FROM = 'Adiutor <mail@adiutor.test>';
    const { sendEmail } = await import('./email');

    await sendEmail(EMAIL);

    expect(mocks.transports[0]?.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Adiutor <mail@adiutor.test>' }),
    );
  });

  it('keeps its transport while the setting stays the same, and replaces it after a save', async () => {
    const { sendEmail } = await import('./email');

    await sendEmail(EMAIL);
    await sendEmail(EMAIL);
    expect(mocks.transports).toHaveLength(1);

    mocks.saved.current = { ...SAVED, host: 'smtp2.adiutor.test' };
    await sendEmail(EMAIL);

    expect(mocks.transports).toHaveLength(2);
    expect(mocks.transports[0]?.close).toHaveBeenCalledOnce();
    expect(mocks.transports[1]?.options).toMatchObject({ host: 'smtp2.adiutor.test' });
  });

  it('builds the new transport once when sends after a save come at the same moment', async () => {
    const { sendEmail } = await import('./email');
    await sendEmail(EMAIL);

    mocks.saved.current = { ...SAVED, host: 'smtp2.adiutor.test' };
    await Promise.all([sendEmail(EMAIL), sendEmail(EMAIL)]);

    // The old transport closed once; the new one kept, never closed under a send.
    expect(mocks.transports).toHaveLength(2);
    expect(mocks.transports[0]?.close).toHaveBeenCalledOnce();
    expect(mocks.transports[1]?.close).not.toHaveBeenCalled();
    expect(mocks.transports[1]?.sendMail).toHaveBeenCalledTimes(2);
  });

  it('signs in to no server without a username, and secures it as saved', async () => {
    mocks.saved.current = { ...SAVED, security: 'tls', port: 465, username: null, password: null };
    const { sendEmail } = await import('./email');

    await sendEmail(EMAIL);

    expect(mocks.transports[0]?.options).toMatchObject({ secure: true, requireTLS: false });
    expect(mocks.transports[0]?.options).not.toHaveProperty('auth');
  });

  it('fails in production without any mail server, naming both places to set one up', async () => {
    mocks.saved.current = null;
    const { sendEmail } = await import('./email');

    await expect(sendEmail(EMAIL)).rejects.toThrow(
      /SMTP_URL, or set one up on the Connections tab/,
    );
    expect(mocks.transports).toHaveLength(0);
  });

  it('prints the email in development without any mail server', async () => {
    mocks.saved.current = null;
    mocks.env.NODE_ENV = 'development';
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { sendEmail } = await import('./email');

    await sendEmail(EMAIL);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('Your Adiutor sign-in link'));
  });
});

describe('sendThrough', () => {
  it('sends one email through the given server, not the saved one, and closes its connection', async () => {
    const { sendThrough } = await import('./email');
    const tried: SmtpConfig = {
      ...SAVED,
      host: 'new.adiutor.test',
      password: 'typed-password',
      from: { name: null, address: 'helpdesk@adiutor.test' },
    };

    await sendThrough(tried, EMAIL);

    expect(mocks.transports).toHaveLength(1);
    const [transport] = mocks.transports;
    expect(transport?.options).toMatchObject({
      host: 'new.adiutor.test',
      auth: { user: 'mailer@adiutor.test', pass: 'typed-password' },
    });
    expect(transport?.options).not.toHaveProperty('pool');
    expect(transport?.sendMail).toHaveBeenCalledWith({ from: 'helpdesk@adiutor.test', ...EMAIL });
    expect(transport?.close).toHaveBeenCalledOnce();
  });

  it('closes its connection when the server refuses, and passes the refusal on', async () => {
    const { sendThrough } = await import('./email');
    const refusal = Object.assign(new Error('535 bad login'), { code: 'EAUTH' });
    mocks.createTransport.mockImplementationOnce((options: Record<string, unknown>) => {
      const transport = { options, sendMail: vi.fn().mockRejectedValue(refusal), close: vi.fn() };
      mocks.transports.push(transport);
      return transport;
    });

    await expect(sendThrough(SAVED, EMAIL)).rejects.toBe(refusal);
    expect(mocks.transports[0]?.close).toHaveBeenCalledOnce();
  });
});
