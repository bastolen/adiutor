/**
 * @file Signing an account in once for a whole spec, for the tests that act as
 * that account throughout: they open each test's context with the stored
 * cookies instead of signing in through the form again, which keeps them
 * clear of the sign-in limits. A test that signs out, ends sessions or
 * switches person signs in with `signIn` instead (signing out ends the shared
 * session).
 */
import { defined } from '../../src/lib/defined';
import { type StorageState, storageStateFor } from './helpers';
import { test } from './test';

/**
 * Signs an account in before the tests of the spec (or of the `describe` it's
 * called in), once, and gives their cookies. Call it at the top of the spec
 * or the `describe`, not inside a test.
 *
 * @param account - The account to sign in as, with its authenticator secret if it has one.
 * @returns A function that gives the signed-in cookies, for `context.addCookies`.
 */
export function signedInOnce(
  account: Parameters<typeof storageStateFor>[1],
): () => StorageState['cookies'] {
  let cookies: StorageState['cookies'] | undefined;
  test.beforeAll(async ({ browser }) => {
    ({ cookies } = await storageStateFor(browser, account));
  });
  return () => defined(cookies, `the cookies of ${account.email}`);
}
