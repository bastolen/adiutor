/**
 * @file The rate-limit key for wrong passwords typed for an address, and the
 * reset of its pause. The limit itself is in `auth-guards/attempts.ts`; the
 * generic limiter is `src/server/rate-limit.ts`.
 */
import type { DatabaseOrTransaction } from '@/db';
import { normalizeEmail } from '@/lib/email-address';

import { resetRateLimit } from '../rate-limit';

/**
 * The key counting wrong passwords typed for an address (the per-address
 * limit in `src/server/auth/auth-guards/`). Stored: changing it resets live
 * counts.
 *
 * @param email - The address, as typed.
 * @returns The key, for the trimmed, lower-cased address.
 */
export function failedSignInsKey(email: string): string {
  return `sign-in-failed:email:${normalizeEmail(email) ?? ''}`;
}

/**
 * Lifts the pause on password sign-in after wrong passwords for an address,
 * once someone proved they control its inbox (a completed password reset, an
 * accepted invitation) or on first-run setup, which just chose its password.
 *
 * @param conn - Database client or transaction.
 * @param email - The address.
 */
export async function clearFailedSignIns(
  conn: DatabaseOrTransaction,
  email: string,
): Promise<void> {
  await resetRateLimit(conn, failedSignInsKey(email));
}
