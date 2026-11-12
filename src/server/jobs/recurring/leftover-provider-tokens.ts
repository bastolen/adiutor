/**
 * @file The job that clears OAuth tokens a GitHub or Google sign-in left
 * behind. They're only needed during the request that stored them (see
 * `withoutKeptTokens` in `src/server/auth/auth-events/provider-accounts.ts`);
 * a request that failed halfway can leave them, and any still there after
 * ten minutes are cleared. It runs on every tick.
 */
import { and, isNotNull, lt, or, sql } from 'drizzle-orm';

import { account } from '@/db/schema';

import { defineRecurringJob } from '../define';

export default defineRecurringJob({
  name: 'leftover-provider-tokens',
  schedule: '*/5 * * * *',
  /**
   * Clears the tokens.
   *
   * @param ctx - Service context (only the database is used).
   * @returns How many accounts had tokens cleared.
   */
  run: async (ctx) => {
    const cleared = await ctx.db
      .update(account)
      .set({ accessToken: null, refreshToken: null, idToken: null })
      .where(
        and(
          or(
            isNotNull(account.accessToken),
            isNotNull(account.refreshToken),
            isNotNull(account.idToken),
          ),
          lt(account.updatedAt, sql`now() - interval '10 minutes'`),
        ),
      )
      .returning({ id: account.id });
    return { summary: { accounts: cleared.length } };
  },
});
