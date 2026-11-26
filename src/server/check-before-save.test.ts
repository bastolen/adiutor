/**
 * @file Tests for trying settings before they're saved: a known failure
 * becomes a refusal by its kind, logged by its kind alone, and anything else
 * is thrown as it is.
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import checkBeforeSaving from './check-before-save';
import { ServiceError } from './errors';

/** A failure of a kind the test knows, with a reply that must never be shown. */
class KnownFailure extends Error {
  /**
   * Makes the failure.
   *
   * @param kind - Its kind.
   */
  constructor(readonly kind: 'refused' | 'unreachable') {
    super('530 5.7.0 the server said something secret');
  }
}

/**
 * The kind of a failure the test knows.
 *
 * @param error - What the test threw.
 * @returns Its kind, or `null`.
 */
const kindOf = (error: unknown) => (error instanceof KnownFailure ? error.kind : null);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkBeforeSaving', () => {
  it('goes on when the test passes', async () => {
    await expect(
      checkBeforeSaving(
        'A mail server',
        async () => {},
        kindOf,
        () => 'errors.notFound',
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses a known failure by its kind, logging the kind and nothing the server said', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusal = await checkBeforeSaving(
      'A mail server',
      async () => {
        throw new KnownFailure('refused');
      },
      kindOf,
      (kind) => (kind === 'refused' ? 'errors.forbidden' : 'errors.notFound'),
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ServiceError);
    expect(refusal).toMatchObject({ code: 'invalid', key: 'errors.forbidden' });
    expect(warn).toHaveBeenCalledWith(
      'A mail server failed its test before it was saved:',
      'refused',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('throws anything else as it is', async () => {
    const other = new Error('a bug');
    await expect(
      checkBeforeSaving(
        'A mail server',
        async () => {
          throw other;
        },
        kindOf,
        () => 'errors.notFound',
      ),
    ).rejects.toBe(other);
  });
});
