/**
 * @file Tests for the secrets worked out from the current auth secret: one
 * for each purpose, the same every time, nothing anyone can make without the
 * current secret, and a new one once the secret is rotated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The app's secret in these tests. */
const APP_SECRET = 'adiutor-tests-secret-0123456789abcdef';

/** A secret rotated in after {@link APP_SECRET}. */
const NEW_SECRET = 'adiutor-tests-new-secret-0123456789abc';

/** A secret rotated in after {@link NEW_SECRET}. */
const NEWER_SECRET = 'adiutor-tests-newer-secret-0123456789a';

/**
 * Loads `derivedSecret` afresh, as an app started with these secrets has it.
 *
 * @param appSecret - The app's secret (`BETTER_AUTH_SECRET`).
 * @param versioned - Its versioned secrets (`BETTER_AUTH_SECRETS`), if any.
 * @returns The function.
 */
async function withAppSecret(appSecret: string, versioned?: string) {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: { BETTER_AUTH_SECRET: appSecret, BETTER_AUTH_SECRETS: versioned },
  }));
  return (await import('./derived-secret')).default;
}

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('derivedSecret', () => {
  it('gives each purpose its own secret, the same every time', async () => {
    const derivedSecret = await withAppSecret(APP_SECRET);

    const mentions = derivedSecret('adiutor mention keys');
    expect(derivedSecret('adiutor mention keys').equals(mentions)).toBe(true);
    expect(derivedSecret('adiutor picture versions').equals(mentions)).toBe(false);
    expect(mentions.toString('utf8')).not.toContain(APP_SECRET);
    expect(mentions).toHaveLength(32);
  });

  it('works out another secret from another app secret', async () => {
    const first = (await withAppSecret(APP_SECRET))('adiutor picture versions');
    const second = (await withAppSecret(`${APP_SECRET}-other`))('adiutor picture versions');

    expect(second.equals(first)).toBe(false);
  });

  it('follows a rotation: the newest versioned secret, never the app secret it replaced', async () => {
    const before = (await withAppSecret(APP_SECRET))('adiutor mention keys');
    const rotated = (await withAppSecret(APP_SECRET, `1:${NEW_SECRET}`))('adiutor mention keys');
    const newOnly = (await withAppSecret(NEW_SECRET))('adiutor mention keys');

    expect(rotated.equals(before)).toBe(false);
    expect(rotated.equals(newOnly)).toBe(true);
  });

  it('stays the same while the newest secret does, whatever older versions follow it', async () => {
    const alone = (await withAppSecret(APP_SECRET, `2:${NEW_SECRET}`))('adiutor picture versions');
    const withOlder = (await withAppSecret(APP_SECRET, `2:${NEW_SECRET},1:${APP_SECRET}`))(
      'adiutor picture versions',
    );
    const newer = (await withAppSecret(APP_SECRET, `3:${NEWER_SECRET},2:${NEW_SECRET}`))(
      'adiutor picture versions',
    );

    expect(withOlder.equals(alone)).toBe(true);
    expect(newer.equals(alone)).toBe(false);
  });
});
