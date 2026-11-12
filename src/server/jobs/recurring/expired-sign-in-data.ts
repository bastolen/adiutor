/**
 * @file The hourly job that deletes sign-in data nobody can use any more:
 * expired sign-in links, codes and reset tokens, expired sessions, and
 * finished rate-limit windows (the app's and Better Auth's). Invitations and
 * invite links are kept as history; their tokens are stored hashed and stop
 * working when they expire.
 */
import { lt, sql } from 'drizzle-orm';

import { rateLimit, rateLimitBucket, session, verification } from '@/db/schema';

import { defineRecurringJob } from '../define';

/** How long Better Auth's rate-limit rows stay after their last request, in hours. */
const BETTER_AUTH_LIMIT_HOURS = 24;

export default defineRecurringJob({
  name: 'expired-sign-in-data',
  schedule: '0 * * * *',
  /**
   * Deletes the expired rows.
   *
   * @param ctx - Service context (only the database is used).
   * @returns How many rows were deleted per kind.
   */
  run: async (ctx) => {
    const [verifications, sessions, buckets, betterAuthLimits] = await Promise.all([
      ctx.db
        .delete(verification)
        .where(lt(verification.expiresAt, sql`now()`))
        .returning({ id: verification.id }),
      ctx.db
        .delete(session)
        .where(lt(session.expiresAt, sql`now()`))
        .returning({ id: session.id }),
      ctx.db
        .delete(rateLimitBucket)
        .where(lt(rateLimitBucket.resetAt, sql`now()`))
        .returning({ id: rateLimitBucket.id }),
      // Better Auth's windows are at most minutes long; a day without requests means it's done.
      ctx.db
        .delete(rateLimit)
        .where(lt(rateLimit.lastRequest, Date.now() - BETTER_AUTH_LIMIT_HOURS * 60 * 60 * 1000))
        .returning({ id: rateLimit.id }),
    ]);
    return {
      summary: {
        verifications: verifications.length,
        sessions: sessions.length,
        rateLimits: buckets.length + betterAuthLimits.length,
      },
    };
  },
});
