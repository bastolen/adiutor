/**
 * @file Tests for the start-up warning about a production server that can't
 * send email: neither the environment nor Settings names a mail server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type EmailDeliverySettings,
  emailDeliveryWarning,
  warnIfEmailCantBeSent,
} from './email-check';

/** The server's settings, and the mail server saved in Settings, which each test sets. */
const settings = vi.hoisted(() => {
  const current: EmailDeliverySettings = {};
  return { current, saved: null as object | null, reads: 0 };
});

vi.mock('@/lib/env', () => ({
  /**
   * The settings the test set, read when the check runs.
   *
   * @returns The settings.
   */
  get env() {
    return settings.current;
  },
}));

vi.mock('@/db', () => ({ db: {} }));

vi.mock('./settings', () => ({
  /**
   * The saved mail server the test set.
   *
   * @returns The setting.
   */
  readSettings: async () => {
    settings.reads += 1;
    return { 'email.smtp': settings.saved };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  settings.saved = null;
  settings.reads = 0;
});

describe('emailDeliveryWarning', () => {
  it('warns about production without a mail server, naming both places to set one up', () => {
    expect(emailDeliveryWarning({ NODE_ENV: 'production' })).toMatch(
      /^No mail server is set up \(SMTP_URL, or the Email tab of Settings\)/,
    );
  });

  it.each([
    ['a mail server', { SMTP_URL: 'smtps://user:secret@smtp.adiutor.dev:465' }],
    ['the end-to-end tests’ outbox', { EMAIL_OUTBOX_DIR: '/tmp/adiutor-outbox' }],
  ])('says nothing about production with %s', (_what, set) => {
    expect(emailDeliveryWarning({ NODE_ENV: 'production', ...set })).toBeNull();
  });

  it('says nothing about production with a mail server saved in Settings', () => {
    expect(emailDeliveryWarning({ NODE_ENV: 'production' }, true)).toBeNull();
  });

  it.each(['development', 'test', undefined])(
    'says nothing outside production (%s), which prints emails instead',
    (nodeEnv) => {
      expect(emailDeliveryWarning({ NODE_ENV: nodeEnv })).toBeNull();
    },
  );
});

describe('warnIfEmailCantBeSent', () => {
  it('logs the warning for this server, and nothing from its configuration', async () => {
    const warn = vi.fn();
    vi.stubGlobal('console', { ...console, warn });
    settings.current = { NODE_ENV: 'production', EMAIL_OUTBOX_DIR: '' };

    await warnIfEmailCantBeSent();

    expect(warn).toHaveBeenCalledExactlyOnceWith(emailDeliveryWarning({ NODE_ENV: 'production' }));
  });

  it('logs nothing when a mail server is saved in Settings', async () => {
    const warn = vi.fn();
    vi.stubGlobal('console', { ...console, warn });
    settings.current = { NODE_ENV: 'production' };
    settings.saved = { host: 'smtp.adiutor.dev' };

    await warnIfEmailCantBeSent();

    expect(warn).not.toHaveBeenCalled();
  });

  it('logs nothing, and reads no settings, when the environment names a mail server', async () => {
    const warn = vi.fn();
    vi.stubGlobal('console', { ...console, warn });
    settings.current = { NODE_ENV: 'production', SMTP_URL: 'smtps://smtp.adiutor.dev:465' };

    await warnIfEmailCantBeSent();

    expect(warn).not.toHaveBeenCalled();
    expect(settings.reads).toBe(0);
  });
});
