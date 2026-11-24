/**
 * @file Reads the roles an account holds: its staff role and its role in
 * each company. A deactivated account keeps them, so they're what
 * reactivating it gives back (`reactivationGrants`), for the reactivation
 * itself and for the user page, which asks the Admin to confirm it's them
 * first when that needs it (`reactivationNeedsConfirmation`).
 */
import { eq } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { membership, user } from '@/db/schema';
import type { KeptRoles } from '@/lib/authz/guards';

/**
 * Loads an account's staff role and company roles. Read inside the
 * reactivation's transaction, once the account's row is locked, it sees the
 * roles as they are when the account is reactivated.
 *
 * @param db - Database client or transaction.
 * @param userId - The account.
 * @returns Its roles; none for an unknown account.
 */
export default async function loadKeptRoles(
  db: DatabaseOrTransaction,
  userId: string,
): Promise<KeptRoles> {
  // One after the other: a transaction runs one statement at a time.
  const [found] = await db
    .select({ staffRole: user.platformRole })
    .from(user)
    .where(eq(user.id, userId));
  const memberships = await db
    .select({ role: membership.role })
    .from(membership)
    .where(eq(membership.userId, userId));
  return {
    staffRole: found?.staffRole ?? null,
    companyRoles: memberships.map(({ role }) => role),
  };
}
