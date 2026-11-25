/**
 * @file Trusted devices: browsers where the user ticked "Trust this device"
 * at the code step, which skip that step until 30 days after the last
 * password sign-in there. Better Auth keeps one verification row per device
 * (`trust-device-…`, valued with the user's ID) and replaces it with a new
 * one, good for another 30 days, at every password sign-in that skips the
 * step (its two-factor plugin has no setting for that). Its cookie also needs
 * an HMAC with the auth secret, so the identifier is stored as is (see
 * `verification.storeIdentifier` in `src/lib/auth.ts`). The browser's cookie
 * holds `<HMAC>!<identifier>`.
 */
import { and, eq, like } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { verification } from '@/db/schema';

/** The identifier prefix of Better Auth's trusted-device rows. */
const TRUST_DEVICE_PREFIX = 'trust-device-';

/**
 * Forgets every device a user trusted, so their next password sign-in asks
 * for the code step again. Callers use `forgetSecondStepSkips`
 * (`./second-step-skips.ts`), which lists when and also ends the links in
 * emails about requests.
 *
 * @param db - Database client or transaction.
 * @param userId - The user.
 */
export async function forgetTrustedDevices(
  db: DatabaseOrTransaction,
  userId: string,
): Promise<void> {
  await db
    .delete(verification)
    .where(
      and(like(verification.identifier, `${TRUST_DEVICE_PREFIX}%`), eq(verification.value, userId)),
    );
}

/**
 * Forgets every trusted device of every user, when everyone is signed out
 * after a suspected leak (`revokeAllSessions`).
 *
 * @param db - Database client or transaction.
 */
export async function forgetAllTrustedDevices(db: DatabaseOrTransaction): Promise<void> {
  await db.delete(verification).where(like(verification.identifier, `${TRUST_DEVICE_PREFIX}%`));
}

/**
 * Finds whose trusted device an identifier (from a browser's trusted-device
 * cookie) is.
 *
 * @param db - Database client or transaction.
 * @param identifier - The identifier, e.g. `trust-device-…`.
 * @returns The user's ID, or `null` when it isn't (or no longer is) a trusted device.
 */
export async function trustedDeviceUser(
  db: DatabaseOrTransaction,
  identifier: string,
): Promise<string | null> {
  if (!identifier.startsWith(TRUST_DEVICE_PREFIX)) {
    return null;
  }
  const [found] = await db
    .select({ userId: verification.value })
    .from(verification)
    .where(eq(verification.identifier, identifier));
  return found?.userId ?? null;
}

/**
 * Forgets one trusted device, so a copy of its cookie no longer skips the
 * code step either: a browser's own when it signs out, or another user's
 * when someone signs in there. Identifiers of other verification rows are
 * left alone.
 *
 * @param db - Database client or transaction.
 * @param identifier - The identifier, e.g. `trust-device-…`.
 */
export async function forgetTrustedDevice(
  db: DatabaseOrTransaction,
  identifier: string,
): Promise<void> {
  if (!identifier.startsWith(TRUST_DEVICE_PREFIX)) {
    return;
  }
  await db.delete(verification).where(eq(verification.identifier, identifier));
}
