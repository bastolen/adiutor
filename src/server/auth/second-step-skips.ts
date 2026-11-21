/**
 * @file Forgets what lets a browser past a user's second step without
 * proving it: trusted devices ("Trust this device" at the code step,
 * `./trusted-devices.ts`) and the links in emails about requests (decision
 * 0035, `./request-links.ts`). Both are forgotten together, whenever the
 * user's sessions are ended (signing out everywhere or one device, an
 * Admin's sign-out, an MFA reset, a deactivation, the command line), their
 * password is changed or reset, two-step verification is turned off, or an
 * authenticator app is set up next to email codes.
 */
import { and, eq, gt, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { requestSignInLink } from '@/db/schema';

import { forgetAllTrustedDevices, forgetTrustedDevices } from './trusted-devices';

/**
 * Forgets a user's trusted devices and ends their request links. An ended
 * link still names its request on its confirmation page, so signing in
 * another way returns there, until the hourly `expired-sign-in-data` job
 * deletes it.
 *
 * @param db - Database client or transaction (the change's own).
 * @param userId - The user.
 */
export async function forgetSecondStepSkips(
  db: DatabaseOrTransaction,
  userId: string,
): Promise<void> {
  await forgetTrustedDevices(db, userId);
  await db
    .update(requestSignInLink)
    .set({ expiresAt: sql`now()` })
    .where(and(eq(requestSignInLink.userId, userId), gt(requestSignInLink.expiresAt, sql`now()`)));
}

/**
 * Forgets every user's trusted devices and ends every request link, when
 * everyone is signed out after a suspected leak (`revokeAllSessions`).
 *
 * @param db - Database client or transaction.
 */
export async function forgetAllSecondStepSkips(db: DatabaseOrTransaction): Promise<void> {
  await forgetAllTrustedDevices(db);
  await db
    .update(requestSignInLink)
    .set({ expiresAt: sql`now()` })
    .where(gt(requestSignInLink.expiresAt, sql`now()`));
}
