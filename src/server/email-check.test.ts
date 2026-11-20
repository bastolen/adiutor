/**
 * @file Tests for the start-up warning about a production server that can't
 * send email.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type EmailDeliverySettings,
  emailDeliveryWarning,
  warnIfEmailCantBeSent,
} from './email-check';

/** The server's settings, which each test sets. */
const settings = vi.hoisted(() => {
  const current: EmailDeliverySettings = {};
  return { current };
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('emailDeliveryWarning', () => {
  it('warns about production without a mail server, naming the setting', () => {
    expect(emailDeliveryWarning({ NODE_ENV: 'production' })).toMatch(/^SMTP_URL isn't set/);
  });

  it.each([
    ['a mail server', { SMTP_URL: 'smtps://user:secret@smtp.adiutor.dev:465' }],
    ['the end-to-end tests’ outbox', { EMAIL_OUTBOX_DIR: '/tmp/adiutor-outbox' }],
  ])('says nothing about production with %s', (_what, set) => {
    expect(emailDeliveryWarning({ NODE_ENV: 'production', ...set })).toBeNull();
  });

  it.each(['development', 'test', undefined])(
    'says nothing outside production (%s), which prints emails instead',
    (nodeEnv) => {
      expect(emailDeliveryWarning({ NODE_ENV: nodeEnv })).toBeNull();
    },
  );
});

describe('warnIfEmailCantBeSent', () => {
  it('logs the warning for this server, and nothing from its configuration', () => {
    const warn = vi.fn();
    vi.stubGlobal('console', { ...console, warn });
    settings.current = { NODE_ENV: 'production', EMAIL_OUTBOX_DIR: '' };

    warnIfEmailCantBeSent();

    expect(warn).toHaveBeenCalledExactlyOnceWith(emailDeliveryWarning({ NODE_ENV: 'production' }));
  });

  it('logs nothing when the server can send email', () => {
    const warn = vi.fn();
    vi.stubGlobal('console', { ...console, warn });
    settings.current = { NODE_ENV: 'production', SMTP_URL: 'smtps://smtp.adiutor.dev:465' };

    warnIfEmailCantBeSent();

    expect(warn).not.toHaveBeenCalled();
  });
});
