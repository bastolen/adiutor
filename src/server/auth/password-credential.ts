/**
 * @file Gives a just-created account its password: Better Auth's credential
 * row, and lifting the wrong-password pause for its address. Used where an
 * account is created with a password it just chose (accepting an emailed
 * invitation with a new account, first-run setup). Kept apart from
 * `accounts.ts` so the setup script loads no more than it needs.
 */
import type { DatabaseTransaction } from '@/db';
import { account } from '@/db/schema';

import { clearFailedSignIns } from './failed-sign-ins';

/**
 * Adds a password to a just-created account, in its transaction: the
 * credential row Better Auth signs in with (`providerId: 'credential'`, the
 * user's ID as its account ID), then lifts the pause on password sign-in for
 * the address. The password was chosen just now, by someone who proved the
 * inbox (an emailed invitation) or set the app up, so wrong passwords typed
 * for the address before don't pause the sign-in that follows.
 *
 * @param tx - The transaction that created the user.
 * @param credential - The account's password.
 * @param credential.userId - The new user.
 * @param credential.email - Their email address (for the pause).
 * @param credential.passwordHash - The password, hashed with Better Auth's `hashPassword`.
 */
export default async function addPasswordCredential(
  tx: DatabaseTransaction,
  credential: { userId: string; email: string; passwordHash: string },
): Promise<void> {
  await tx.insert(account).values({
    userId: credential.userId,
    accountId: credential.userId,
    providerId: 'credential',
    password: credential.passwordHash,
  });
  await clearFailedSignIns(tx, credential.email);
}
