/**
 * @file One change to how a user signs in at a time. Whether a change would
 * take away the MFA a role requires (`wouldRemoveRequiredMfa`), or a reset
 * link's password any account's MFA (`wouldEndMfa`), is checked before Better
 * Auth makes it, so two changes sent at the same moment (e.g. removing both
 * passkeys) could otherwise both pass the check. A change takes
 * this per-user lock before anything about the user is read, and gives it
 * back once the change is made; a second change meanwhile is refused (a
 * provider connected meanwhile at the OAuth callback doesn't count yet). The
 * guards take it for Better Auth's endpoints (`auth-guards/`, also for a
 * password set through a reset or welcome link), the OAuth
 * callback when it decides whether a provider counts (`auth-events/`), and
 * the app's own sign-in changes through {@link withSignInChangeLock}. The
 * lock is a row in the rate-limit table (`rate-limit.ts`), so taking it is
 * one atomic statement; a request that dies without giving it back frees it
 * after {@link SIGN_IN_CHANGE_LOCK_SECONDS} seconds.
 */
import { and, eq, sql } from 'drizzle-orm';

import { rateLimitBucket } from '@/db/schema';
import { SIGN_IN_CHANGE_IN_PROGRESS } from '@/lib/sign-in/sign-in-refusals';

import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { hitRateLimit } from '../rate-limit';

/** How long a lock holds at most, if the request that took it never gives it back. */
const SIGN_IN_CHANGE_LOCK_SECONDS = 30;

/** A lock that was taken: its key and when it expires, which tells this lock from a later one. */
export interface SignInChangeLock {
  /** The user it's for. */
  userId: string;
  /** The rate-limit key, per user. */
  key: string;
  /** When it frees itself. */
  until: Date;
}

/**
 * The lock's key for a user.
 *
 * @param userId - The user.
 * @returns The key.
 */
const lockKey = (userId: string) => `sign-in-change:user:${userId}`;

/**
 * Takes a user's lock, if no other change holds it.
 *
 * @param ctx - Service context (only the database is used).
 * @param userId - The user.
 * @returns The lock, or `null` while another change holds it.
 */
export async function takeSignInChangeLock(
  ctx: Pick<ServiceContext, 'db'>,
  userId: string,
): Promise<SignInChangeLock | null> {
  const key = lockKey(userId);
  const { hits, resetAt } = await hitRateLimit(ctx, key, {
    limit: 1,
    windowSeconds: SIGN_IN_CHANGE_LOCK_SECONDS,
  });
  return hits === 1 ? { userId, key, until: resetAt } : null;
}

/**
 * Gives a lock back. Only frees that lock: once it has expired and another
 * change took the user's lock since, that one is left alone.
 *
 * @param ctx - Service context (only the database is used).
 * @param lock - The lock.
 */
export async function releaseSignInChangeLock(
  ctx: Pick<ServiceContext, 'db'>,
  lock: SignInChangeLock,
): Promise<void> {
  await ctx.db.delete(rateLimitBucket).where(
    and(
      eq(rateLimitBucket.key, lock.key),
      // JavaScript dates have milliseconds; Postgres keeps microseconds.
      sql`date_trunc('milliseconds', ${rateLimitBucket.resetAt}) = ${lock.until}`,
    ),
  );
}

/**
 * Runs a sign-in change made by the app itself while holding the user's lock.
 *
 * @param ctx - Service context.
 * @param userId - The user whose sign-in it changes.
 * @param change - The change, including the checks it needs (read after taking the lock).
 * @returns What the change returned.
 * @throws {ServiceError} `conflict` while another change holds the lock.
 */
export async function withSignInChangeLock<T>(
  ctx: Pick<ServiceContext, 'db'>,
  userId: string,
  change: () => Promise<T>,
): Promise<T> {
  const lock = await takeSignInChangeLock(ctx, userId);
  if (!lock) {
    throw new ServiceError('conflict', SIGN_IN_CHANGE_IN_PROGRESS.message);
  }
  try {
    return await change();
  } finally {
    await releaseSignInChangeLock(ctx, lock);
  }
}
