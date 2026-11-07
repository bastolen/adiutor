/**
 * @file The lock on the open invitations of one address to one company or the
 * staff, so requests at the same moment can't leave two open invitations
 * or revive a revoked one (see "Lock order" in docs/security-measures.md).
 */
import { sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';

/**
 * The key of the per-address lock ({@link lockInvitationsOf}) for one target
 * and address.
 *
 * @param companyId - The company, or `null` for staff.
 * @param email - Normalized email address.
 * @returns E.g. `invitation:staff:user@adiutor.dev`.
 */
export function invitationLockKey(companyId: string | null, email: string): string {
  return `invitation:${companyId ?? 'staff'}:${email}`;
}

/**
 * Takes a per-address lock by its key ({@link invitationLockKey}): a
 * transaction-scoped advisory lock, held until the transaction ends.
 *
 * @param tx - Transaction (the lock lasts until it ends).
 * @param key - The lock's key.
 */
export async function takeInvitationLock(tx: DatabaseTransaction, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/**
 * Makes requests about the invitations of one address and target take
 * turns: a transaction-scoped advisory lock, held until the transaction ends.
 * Taken by everything that opens or closes an invitation for an address
 * (`createInvitationRecord`, resending, revoking, {@link revokeInvitationsTo});
 * see `createInvitationRecord` for why.
 *
 * @param tx - Transaction (the lock lasts until it ends).
 * @param companyId - The company, or `null` for staff.
 * @param email - Normalized email address.
 */
export async function lockInvitationsOf(
  tx: DatabaseTransaction,
  companyId: string | null,
  email: string,
): Promise<void> {
  await takeInvitationLock(tx, invitationLockKey(companyId, email));
}
