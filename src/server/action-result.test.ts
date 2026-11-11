/**
 * @file Tests for `runAction`: which errors become a failed result with a
 * message in the request's language, and which are rethrown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { companyNameSchema } from '@/lib/validation';

import { testLocale } from '../../tests/i18n/next-intl-mocks';
import runAction from './action-result';
import { ServiceError } from './errors';

/**
 * Builds the error Drizzle throws when Postgres breaks a deadlock: its own
 * error, with the driver's (SQLSTATE `40P01`) as the cause.
 *
 * @returns The error.
 */
function deadlockError(): Error {
  return new Error('Failed query', {
    cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runAction', () => {
  it('returns what the work returns', async () => {
    await expect(runAction(async () => ({ ok: true, message: 'Saved.' }))).resolves.toEqual({
      ok: true,
      message: 'Saved.',
    });
  });

  it('shows the message of a service error', async () => {
    await expect(
      runAction(async () => {
        throw new ServiceError('conflict', 'errors.members.lastAdmin');
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'A company needs at least one admin. Make someone else an admin first.',
    });
  });

  it('shows the first problem of invalid input', async () => {
    await expect(
      runAction(async () => {
        z.email({ error: 'validation.email' }).parse('nope');
        return { ok: true };
      }),
    ).resolves.toEqual({ ok: false, message: 'Enter a valid email address.' });
  });

  it('turns a database deadlock into a conflict that asks to try again, and notes it in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      runAction(async () => {
        throw deadlockError();
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'Someone changed this at the same moment. Try again.',
    });
    expect(warn).toHaveBeenCalledOnce();
    // The log line holds no details of the request or the database.
    expect(warn.mock.calls[0]).toEqual([
      'A server action hit a database deadlock; the user was asked to try again.',
    ]);
  });

  it('rethrows unexpected errors, other database errors included', async () => {
    const failed = new Error('Failed query', {
      cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
    });
    await expect(
      runAction(async () => {
        throw failed;
      }),
    ).rejects.toBe(failed);
  });
});

describe('runAction in other languages', () => {
  it('words a service error in the request’s language', async () => {
    testLocale.current = 'nl-NL';
    await expect(
      runAction(async () => {
        throw new ServiceError('rate_limited', 'errors.tooManyAttempts', { minutes: 3 });
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'Te veel pogingen. Probeer het over 3 minuten opnieuw.',
    });
  });

  it('words invalid input in the request’s language', async () => {
    testLocale.current = 'nl-NL';
    await expect(
      runAction(async () => {
        companyNameSchema.parse('a'.repeat(101));
        return { ok: true };
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'Gebruik maximaal 100 tekens voor de bedrijfsnaam.',
    });
  });

  it('asks to try again after a deadlock in the request’s language', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    testLocale.current = 'nl-NL';
    await expect(
      runAction(async () => {
        throw deadlockError();
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'Iemand anders wijzigde dit op hetzelfde moment. Probeer het opnieuw.',
    });
  });
});
