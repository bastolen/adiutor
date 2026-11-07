/**
 * @file Tests for the sample errors of the dev seed: they look like the
 * errors the app stores (valid references, server references from their
 * digest, unique sign-in references, paths without tokens) and all fall
 * within the 7 days errors are kept.
 */
import { describe, expect, it } from 'vitest';

import { REPEATED_DIGEST, sampleErrors } from './sample-errors';
import { parseErrorReference, referenceFromDigest } from '../src/lib/error-reference';
import { APP_ERROR_RETENTION_DAYS } from '../src/server/app-errors';
import { SIGN_IN_ERROR_RETENTION_DAYS } from '../src/server/auth/sign-in-errors';

/** The time the samples count back from. */
const NOW = new Date('2026-11-03T12:00:00Z');

/** The seeded users, as IDs. */
const USERS = {
  admin: '019a0000-0000-7000-8000-000000000001',
  manager: '019a0000-0000-7000-8000-000000000002',
  support: '019a0000-0000-7000-8000-000000000003',
  alphaAdmin: '019a0000-0000-7000-8000-000000000004',
  multi: '019a0000-0000-7000-8000-000000000005',
};

describe('sampleErrors', () => {
  const { appErrors, signInErrors } = sampleErrors(USERS, NOW);

  it('uses valid references, from the digest for server errors', () => {
    for (const { reference } of [...appErrors, ...signInErrors]) {
      expect(parseErrorReference(reference)).toBe(reference);
    }
    for (const error of appErrors) {
      if (error.digest) {
        expect(error.source).toBe('server');
        expect(error.reference).toBe(referenceFromDigest(error.digest));
      } else {
        expect(error.source).toBe('browser');
      }
    }
  });

  it('stores the repeated server error three times under one reference', () => {
    const repeated = appErrors.filter(({ digest }) => digest === REPEATED_DIGEST);

    expect(repeated).toHaveLength(3);
    expect(new Set(repeated.map(({ reference }) => reference)).size).toBe(1);
  });

  it('draws unique sign-in references, also when added again', () => {
    const again = sampleErrors(USERS, NOW).signInErrors;
    const references = [...signInErrors, ...again].map(({ reference }) => reference);

    expect(new Set(references).size).toBe(references.length);
  });

  it('dates every error within the days errors are kept', () => {
    /**
     * The oldest time still kept, counting back from {@link NOW}.
     *
     * @param days - How many days errors are kept.
     * @returns The time, in milliseconds.
     */
    const oldestKept = (days: number) => NOW.getTime() - days * 24 * 60 * 60 * 1000;
    for (const { createdAt } of appErrors) {
      expect(createdAt?.getTime()).toBeLessThan(NOW.getTime());
      expect(createdAt?.getTime()).toBeGreaterThan(oldestKept(APP_ERROR_RETENTION_DAYS));
    }
    for (const { createdAt } of signInErrors) {
      expect(createdAt?.getTime()).toBeLessThan(NOW.getTime());
      expect(createdAt?.getTime()).toBeGreaterThan(oldestKept(SIGN_IN_ERROR_RETENTION_DAYS));
    }
  });

  it('keeps tokens out of paths', () => {
    const invite = appErrors.find(({ path }) => path?.startsWith('/invite/'));

    expect(invite?.path).toBe('/invite/[token]');
  });

  it('names no one as signed in when the seeded users are missing', () => {
    const anonymous = sampleErrors({}, NOW);

    expect([...anonymous.appErrors, ...anonymous.signInErrors].map(({ userId }) => userId)).toEqual(
      [...anonymous.appErrors, ...anonymous.signInErrors].map(() => null),
    );
    expect(appErrors.some(({ userId }) => userId === USERS.alphaAdmin)).toBe(true);
  });
});
