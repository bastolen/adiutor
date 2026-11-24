/**
 * @file Tests for the secrets worked out from the app's secret: one for each
 * purpose, the same every time, and nothing anyone can make without the
 * app's secret.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The app's secret in these tests. */
const APP_SECRET = 'adiutor-tests-secret-0123456789abcdef';

/**
 * Loads `derivedSecret` afresh, as an app started with this secret has it.
 *
 * @param appSecret - The app's secret (`BETTER_AUTH_SECRET`).
 * @returns The function.
 */
async function withAppSecret(appSecret: string) {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({ env: { BETTER_AUTH_SECRET: appSecret } }));
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
});
