/**
 * @file The app's own rate limits, for actions that send email or check
 * codes or passwords. Better Auth limits its own endpoints separately.
 */
import { and, eq, gt, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { rateLimitBucket } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import type { ServiceContext } from './context';
import { ServiceError } from './errors';

/** A limit: at most `limit` hits per window. */
export interface RateLimitRule {
  /** How many hits are allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** The limits used by the app, by purpose. */
export const RATE_LIMITS = {
  /**
   * Invitations (those sent by claiming an invite link included, counted for
   * the link's creator), added members, registered users and companies, by the
   * user who sends them.
   */
  invitesPerUser: { limit: 30, windowSeconds: 60 * 60 },
  /** Invitations sent to one company (or to the staff), invite links claimed for it included. */
  invitesPerCompany: { limit: 60, windowSeconds: 60 * 60 },
  /**
   * Role changes one user makes, company and staff roles together (making
   * someone staff included, removals not): each one emails the member, so
   * switching a role back and forth can't flood their inbox.
   */
  roleChangesPerUser: { limit: 30, windowSeconds: 60 * 60 },
  /** Invite links claimed from one IP address. */
  linkClaimsPerIp: { limit: 10, windowSeconds: 60 * 60 },
  /** Verification emails requested by one user. */
  verificationEmailsPerUser: { limit: 3, windowSeconds: 15 * 60 },
  /**
   * Sign-in link pages opened from one IP address with a link that can't be
   * used (expired, used or never valid): looking links up can't be used to
   * guess them.
   */
  emailLinkMissesPerIp: { limit: 20, windowSeconds: 15 * 60 },
  /** Sign-in errors stored from one IP address (`recordSignInError`); more are only logged. */
  signInErrorsPerIp: { limit: 20, windowSeconds: 60 * 60 },
  /**
   * Errors in the app stored from one IP address (`recordAppError`): errors
   * the server reports, and those the error page reports from the browser.
   * More are only logged.
   */
  appErrorsPerIp: { limit: 20, windowSeconds: 60 * 60 },
  /** Wrong secrets sent to the jobs' endpoint from one IP address; past it, the endpoint answers 429. */
  jobTickMissesPerIp: { limit: 20, windowSeconds: 15 * 60 },
  /**
   * Wrong current passwords typed by one signed-in user, when changing the
   * password or deactivating the account (`checkCurrentPassword`): a session
   * can't be used to guess the password. A bucket of its own, not the
   * address's sign-in one, so a stolen session can't pause the owner's
   * password sign-in.
   */
  wrongCurrentPasswordsPerUser: { limit: 5, windowSeconds: 15 * 60 },
  /**
   * Times one staff member starts signing in as someone
   * (`startImpersonation`): each one emails the user.
   */
  impersonationsPerUser: { limit: 10, windowSeconds: 60 * 60 },
  /** Requests one user raises: far more than anyone raises by hand, few enough to stop a flood. */
  requestsPerUser: { limit: 60, windowSeconds: 60 * 60 },
  /** Replies one user writes to requests. */
  requestRepliesPerUser: { limit: 200, windowSeconds: 60 * 60 },
  /** Changes one user makes to requests: their status, and their title, type and priority. */
  requestChangesPerUser: { limit: 300, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Counts a hit against a limit. One atomic statement: the window starts on
 * the first hit and restarts once it has passed.
 *
 * In a transaction (`{ db: tx }`), the hit is undone if the transaction rolls
 * back, and the bucket's row stays locked until it ends: requests counting
 * against the same bucket that way take turns.
 *
 * @param ctx - Service context, or just a database client or transaction.
 * @param ctx.db - Where to count it.
 * @param key - What's limited, e.g. `invite:user:<id>`.
 * @param rule - The limit.
 * @returns Whether the hit is allowed, the hits in the window so far (this
 *   one included), when the window resets and how many seconds that is from now.
 */
export async function hitRateLimit(
  ctx: { db: DatabaseOrTransaction },
  key: string,
  rule: RateLimitRule,
): Promise<{ allowed: boolean; hits: number; resetAt: Date; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${rule.windowSeconds})`;
  const row = firstRow(
    await ctx.db
      .insert(rateLimitBucket)
      .values({ key, count: 1, resetAt: sql`now() + ${window}` })
      .onConflictDoUpdate({
        target: rateLimitBucket.key,
        set: {
          count: sql`case when ${rateLimitBucket.resetAt} <= now() then 1 else ${rateLimitBucket.count} + 1 end`,
          resetAt: sql`case when ${rateLimitBucket.resetAt} <= now() then now() + ${window} else ${rateLimitBucket.resetAt} end`,
        },
      })
      .returning({ count: rateLimitBucket.count, resetAt: rateLimitBucket.resetAt }),
    'the rate limit bucket',
  );
  return {
    allowed: row.count <= rule.limit,
    hits: row.count,
    resetAt: row.resetAt,
    retryAfterSeconds: Math.max(0, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000)),
  };
}

/**
 * Checks whether a limit is used up, without counting a hit. For limits on
 * failures: check before the attempt, count with {@link hitRateLimit} only
 * when it fails. Where attempts at the same moment must not all get through,
 * count before instead and give the hit back with {@link releaseRateLimitHit}
 * when it succeeds.
 *
 * @param ctx - Service context.
 * @param key - What's limited.
 * @param rule - The limit.
 * @returns Whether it's used up, and how many seconds until the window resets.
 */
export async function peekRateLimit(
  ctx: Pick<ServiceContext, 'db'>,
  key: string,
  rule: RateLimitRule,
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const [row] = await ctx.db
    .select({ count: rateLimitBucket.count, resetAt: rateLimitBucket.resetAt })
    .from(rateLimitBucket)
    .where(and(eq(rateLimitBucket.key, key), gt(rateLimitBucket.resetAt, sql`now()`)));
  return {
    limited: row !== undefined && row.count >= rule.limit,
    retryAfterSeconds: row
      ? Math.max(0, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000))
      : 0,
  };
}

/**
 * Gives back one hit counted earlier in the current window (e.g. an attempt
 * taken before a check that then succeeded). Never below zero.
 *
 * @param ctx - Service context.
 * @param key - What's limited.
 */
export async function releaseRateLimitHit(
  ctx: Pick<ServiceContext, 'db'>,
  key: string,
): Promise<void> {
  await ctx.db
    .update(rateLimitBucket)
    .set({ count: sql`greatest(${rateLimitBucket.count} - 1, 0)` })
    .where(and(eq(rateLimitBucket.key, key), gt(rateLimitBucket.resetAt, sql`now()`)));
}

/**
 * Clears a limit: its window ends now, as if nothing had been counted (e.g.
 * the wait for a new emailed code, once a code was used).
 *
 * @param conn - Database client or transaction.
 * @param key - What's limited.
 */
export async function resetRateLimit(conn: DatabaseOrTransaction, key: string): Promise<void> {
  await conn.delete(rateLimitBucket).where(eq(rateLimitBucket.key, key));
}

/**
 * How long until a limit's window resets, in whole minutes, for messages
 * that say how long to wait (`{minutes, plural, ...}`).
 *
 * @param retryAfterSeconds - When the window resets.
 * @returns The minutes, rounded up (at least 1).
 */
export function waitMinutes(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}

/**
 * The error for a used-up limit: "Too many attempts. Try again in N
 * minutes." (`errors.tooManyAttempts`, at least 1 minute).
 *
 * @param retryAfterSeconds - When the window resets.
 * @returns The error (`rate_limited`).
 */
export function tooManyAttemptsError(retryAfterSeconds: number): ServiceError {
  return new ServiceError('rate_limited', 'errors.tooManyAttempts', {
    minutes: waitMinutes(retryAfterSeconds),
  });
}

/**
 * Counts a hit and refuses it when the limit is reached.
 *
 * @param ctx - Service context, or just a database client or transaction (see
 *   {@link hitRateLimit}).
 * @param ctx.db - Where to count it.
 * @param key - What's limited.
 * @param rule - The limit.
 * @throws {ServiceError} `rate_limited`, saying how long to wait.
 */
export async function assertRateLimit(
  ctx: { db: DatabaseOrTransaction },
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  const { allowed, retryAfterSeconds } = await hitRateLimit(ctx, key, rule);
  if (!allowed) {
    throw tooManyAttemptsError(retryAfterSeconds);
  }
}

/**
 * Builds the key of a limit per IP address, `<purpose>:ip:<address>`, from
 * the address of the request being served (`ctx.requestInfo`). Outside a
 * request, or when the address isn't known, the key ends in `unknown`: those
 * hits share one bucket per purpose, so the limit still holds. Keys are
 * stored: changing a purpose resets its live counts.
 *
 * @param ctx - Service context; `requestInfo` gives the IP address.
 * @param purpose - What's limited, e.g. `invite-link-claim`.
 * @returns The key, e.g. `invite-link-claim:ip:203.0.113.7`.
 */
export async function ipRateLimitKey(
  ctx: Pick<ServiceContext, 'requestInfo'>,
  purpose: string,
): Promise<string> {
  const request = ctx.requestInfo ? await ctx.requestInfo() : null;
  return `${purpose}:ip:${request?.ip ?? 'unknown'}`;
}

/**
 * Counts an email a user sends to someone else (an invitation, a resend, a
 * new member's notice, a registered user's welcome, a new company's first
 * Admin invitation, or the invitation a claimed invite link of theirs sends)
 * against the limit per sender, so these can't be used to flood inboxes.
 *
 * @param ctx - Service context, or just a database client or transaction (see
 *   {@link hitRateLimit}).
 * @param ctx.db - Where to count it.
 * @param userId - Who's sending it (for an invite link, who created it).
 * @throws {ServiceError} `rate_limited` when the limit is reached.
 */
export async function assertInviteSenderLimit(
  ctx: { db: DatabaseOrTransaction },
  userId: string,
): Promise<void> {
  await assertRateLimit(ctx, `invite:user:${userId}`, RATE_LIMITS.invitesPerUser);
}

/**
 * Counts a role change a user makes (a company role, or a staff role,
 * making someone staff included) against their limit, before its
 * transaction starts. Every change that goes through emails the member, so
 * the limit is on the change, not the email: the member always hears about
 * their latest role. Removals aren't counted: one can't be repeated without
 * a new invitation, which has limits of its own, and refusing one could keep
 * someone in that an Admin is removing.
 *
 * @param ctx - Service context, or just a database client.
 * @param ctx.db - Where to count it.
 * @param userId - Who's making the change.
 * @throws {ServiceError} `rate_limited` when the limit is reached.
 */
export async function assertRoleChangeLimit(
  ctx: { db: DatabaseOrTransaction },
  userId: string,
): Promise<void> {
  await assertRateLimit(ctx, `role-change:user:${userId}`, RATE_LIMITS.roleChangesPerUser);
}

/**
 * Counts an invitation to a company, or to the staff, against the limit per
 * company (the staff share one bucket): invitations by email, resends, and
 * the invitations claimed invite links send.
 *
 * @param ctx - Service context, or just a database client or transaction (see
 *   {@link hitRateLimit}).
 * @param ctx.db - Where to count it.
 * @param companyId - The company, or `null` for the staff.
 * @throws {ServiceError} `rate_limited` when the limit is reached.
 */
export async function assertInviteCompanyLimit(
  ctx: { db: DatabaseOrTransaction },
  companyId: string | null,
): Promise<void> {
  await assertRateLimit(
    ctx,
    `invite:company:${companyId ?? 'staff'}`,
    RATE_LIMITS.invitesPerCompany,
  );
}
