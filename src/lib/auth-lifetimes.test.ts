/**
 * @file Checks that emailed codes and sign-in links last as long as the
 * pages and emails say (`EMAIL_CODE_MINUTES`, `EMAIL_LINK_MINUTES`): Better
 * Auth's defaults differ (3 minutes for codes), and its plugins don't expose
 * their options, so this reads what the auth config hands them. The same for
 * the pause after wrong codes at sign-in (`TWO_FACTOR_LOCK_MINUTES`), which
 * the lockout email names. Also checks that sessions last a fixed 7 days and
 * aren't extended while they're used.
 * @vitest-environment node
 */
import { magicLink, twoFactor } from 'better-auth/plugins';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { EMAIL_CODE_MINUTES, TWO_FACTOR_LOCK_ATTEMPTS, TWO_FACTOR_LOCK_MINUTES } from './authz/mfa';
import { EMAIL_LINK_MINUTES } from './sign-in/email-link';

vi.hoisted(() => {
  // Loading the auth config validates the environment; nothing here connects to it.
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://adiutor:adiutor@localhost:5432/adiutor_test',
    BETTER_AUTH_SECRET: 'auth-lifetimes-test-secret-0123456789abcdef',
    BETTER_AUTH_URL: 'http://localhost:3000',
  });
});

vi.mock('better-auth/plugins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('better-auth/plugins')>();
  return { ...actual, magicLink: vi.fn(actual.magicLink), twoFactor: vi.fn(actual.twoFactor) };
});

describe('Better Auth lifetimes', () => {
  it('match what the pages and emails tell the user', async () => {
    await import('./auth');

    // Better Auth counts the code's period in minutes and the link's lifetime in seconds.
    expect(
      defined(vi.mocked(twoFactor).mock.calls[0], 'the two-step verification options')[0]
        ?.otpOptions?.period,
    ).toBe(EMAIL_CODE_MINUTES);
    expect(defined(vi.mocked(magicLink).mock.calls[0], 'the email link options')[0].expiresIn).toBe(
      EMAIL_LINK_MINUTES * 60,
    );
    // The pause after wrong codes at sign-in, in seconds; the lockout email says 15 minutes, and
    // is sent at most once per pause.
    expect(
      defined(vi.mocked(twoFactor).mock.calls[0], 'the two-step verification options')[0]
        ?.accountLockout,
    ).toEqual({
      maxFailedAttempts: TWO_FACTOR_LOCK_ATTEMPTS,
      durationSeconds: TWO_FACTOR_LOCK_MINUTES * 60,
    });
    expect(TWO_FACTOR_LOCK_MINUTES).toBe(15);
  });

  it('end sessions 7 days after the sign-in, however much they are used', async () => {
    const { auth } = await import('./auth');

    // In seconds. Pages can't set cookies, so a session extended there would outlive its cookie.
    expect(auth.options.session?.expiresIn).toBe(7 * 24 * 60 * 60);
    expect(auth.options.session?.disableSessionRefresh).toBe(true);
  });
});
