/**
 * @file Tests for the service errors and the database error checks.
 */
import { describe, expect, it } from 'vitest';

import {
  CONCURRENT_CHANGE_MESSAGE,
  concurrentChangeError,
  isDeadlock,
  isUniqueViolation,
  parseId,
  ServiceError,
} from './errors';

describe('parseId', () => {
  it('returns a valid ID unchanged', () => {
    expect(parseId('01900000-0000-7000-8000-000000000000')).toBe(
      '01900000-0000-7000-8000-000000000000',
    );
  });

  it.each(['nope', '', '01900000-0000-7000-8000', ' 01900000-0000-7000-8000-000000000000'])(
    'answers "not found" for %j',
    (value) => {
      expect(() => parseId(value)).toThrow(ServiceError);
      expect(() => parseId(value)).toThrow(
        expect.objectContaining({
          code: 'not_found',
          message: "This page doesn't exist or you don't have access to it.",
        }),
      );
    },
  );
});

describe('database error checks', () => {
  /**
   * Builds an error the way Drizzle throws a failed query: its own error,
   * with the driver's error (carrying the SQLSTATE code) as the cause.
   *
   * @param code - The SQLSTATE code.
   * @returns The wrapped error.
   */
  function drizzleError(code: string): Error {
    return new Error('Failed query', { cause: Object.assign(new Error('driver'), { code }) });
  }

  it('recognises a deadlock (40P01) on the error or its cause', () => {
    expect(isDeadlock(Object.assign(new Error('deadlock detected'), { code: '40P01' }))).toBe(true);
    expect(isDeadlock(drizzleError('40P01'))).toBe(true);
  });

  it('tells deadlocks and unique violations apart from each other and from anything else', () => {
    expect(isDeadlock(drizzleError('23505'))).toBe(false);
    expect(isUniqueViolation(drizzleError('23505'))).toBe(true);
    expect(isUniqueViolation(drizzleError('40P01'))).toBe(false);
    [new Error('nope'), { code: 40 }, null, undefined, '40P01'].forEach((value) => {
      expect(isDeadlock(value)).toBe(false);
    });
  });

  it('asks the user to try again after a concurrent change, as a conflict', () => {
    expect(concurrentChangeError()).toMatchObject({
      code: 'conflict',
      message: CONCURRENT_CHANGE_MESSAGE,
    });
    expect(CONCURRENT_CHANGE_MESSAGE).toBe('Someone changed this at the same moment. Try again.');
  });
});
