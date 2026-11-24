/**
 * @file The checks on an identity coming in from a provider: "Confirm with
 * GitHub" only with the user's own confirmed account, and never for a
 * deactivated account.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { account, user } from '@/db/schema';
import { mayReverifyWith } from '@/lib/authz/mfa';
import {
  accountIdFromProfile,
  isOAuthProvider,
  PROVIDER_STEP_UP_COOKIE,
} from '@/lib/sign-in/oauth-providers';
import { ACCOUNT_DEACTIVATED, REVERIFY_WRONG_ACCOUNT } from '@/lib/sign-in/sign-in-refusals';

import { requestState, takeRequestState } from '../request-state';
import { currentReverify, type ReverifyMarker } from '../reverify-marker';
import { expireCookieIfSent } from './cookies';
import { type AuthHookContext, safely, audit } from './hook-context';
import { reverifiedSession } from './session-records';

/**
 * Notes that a request's re-verify was refused, for {@link afterAuthRequest}.
 *
 * @param ctx - The endpoint context.
 * @param marker - The re-verify.
 * @param providerId - The provider it was answered with, if known.
 */
export function noteRefusedReverify(
  ctx: AuthHookContext | null,
  marker: ReverifyMarker,
  providerId: string | undefined,
): void {
  if (!ctx?.context) {
    return;
  }
  requestState(ctx.context).refusedReverify = {
    userId: marker.userId,
    providerId: providerId ?? null,
  };
}

/**
 * What Better Auth's `user.validateUserInfo` hands over, as far as
 * {@link checkIncomingUser} and {@link checkReverify} read it.
 */
export interface IncomingUserInfo {
  /**
   * The Adiutor user Better Auth resolved: the owner of the provider account
   * that signed in, or the user whose email address matches it.
   */
  user: { id?: string };
  /** Where the identity comes from. */
  source: {
    /** How (`oauth` for a provider). */
    method: string;
    /**
     * `sign-in` for a provider account that's connected already,
     * `link-account` when Better Auth would connect it now.
     */
    action?: string;
    /** The provider and its raw profile, for `oauth`. */
    oauth?: { providerId: string; profile?: unknown };
  };
}

/**
 * Refuses a re-verify ("Confirm with GitHub" on the step-up page, marked by
 * `markReverify`) with any other provider account than the user's own
 * confirmed one (`mayReverifyWith`): a new account with their email address,
 * another user's account, or one of their own that isn't confirmed, and
 * also when the browser no longer has the session it confirms. Called first
 * by {@link checkIncomingUser}, from Better Auth's `user.validateUserInfo`,
 * the earliest point where both the Adiutor user and the provider account
 * are known: before anything is connected, any token is stored or any
 * session is created. Better Auth then
 * sends the browser to the step-up page's `errorCallbackURL` with
 * `?error=REVERIFY_WRONG_ACCOUNT`, and its session cookie stays as it was.
 * {@link afterAuthRequest} records the refusal. Any other request isn't
 * checked. A failure here (e.g. the database) refuses the re-verify too,
 * with Better Auth's own code.
 *
 * @param info - What Better Auth hands over.
 * @param ctx - The endpoint context.
 * @returns `{ error: 'REVERIFY_WRONG_ACCOUNT' }` to refuse, otherwise nothing.
 */
export async function checkReverify(
  info: IncomingUserInfo,
  ctx: AuthHookContext | null,
): Promise<{ error: string } | undefined> {
  const marker = await currentReverify();
  if (!marker) {
    return undefined;
  }
  const providerId = info.source.oauth?.providerId;
  const accountId = isOAuthProvider(providerId)
    ? accountIdFromProfile(providerId, info.source.oauth?.profile)
    : null;
  // The re-verifying user's own account for the provider account that signed in, if any.
  const [own] =
    providerId && accountId
      ? await db
          .select({ confirmed: account.confirmed })
          .from(account)
          .where(
            and(
              eq(account.userId, marker.userId),
              eq(account.providerId, providerId),
              eq(account.accountId, accountId),
            ),
          )
          .limit(1)
      : [];
  const allowed = mayReverifyWith({
    sessionLive: (await reverifiedSession(ctx, marker)) !== null,
    connected: info.source.action === 'sign-in',
    ownAccount: info.user.id === marker.userId && own !== undefined,
    confirmed: own?.confirmed === true,
  });
  if (allowed) {
    return undefined;
  }
  noteRefusedReverify(ctx, marker, providerId);
  return { error: REVERIFY_WRONG_ACCOUNT.code };
}

/**
 * Checks the Adiutor user an incoming identity is for, from Better Auth's
 * `user.validateUserInfo`: before it connects a provider account to them,
 * stores the provider's tokens, marks their email address verified or
 * creates a session (for a new provider account and a connected one alike).
 *
 * 1. The re-verify check comes first ({@link checkReverify}), so a refused
 *    "Confirm with GitHub" never says anything about another user, such as
 *    that they're deactivated.
 * 2. A deactivated user is refused, so nothing gets connected to the account
 *    while it's deactivated (a provider account planted then would sign in
 *    once an Admin reactivates it). Better Auth then sends the browser to the
 *    sign-in's `errorCallbackURL` (or `/sign-in-error`) with
 *    `?error=ACCOUNT_DEACTIVATED`: the same code and message as the session
 *    hook's refusal, only earlier ({@link beforeSessionCreate}, which keeps
 *    refusing as a backstop).
 *
 * An identity without a user (Better Auth creating one, which the app never
 * does) is only checked for a re-verify. A failure here (e.g. the database)
 * refuses the sign-in, with Better Auth's own code.
 *
 * @param info - What Better Auth hands over.
 * @param ctx - The endpoint context.
 * @returns `{ error, errorDescription }` to refuse, otherwise nothing.
 */
export async function checkIncomingUser(
  info: IncomingUserInfo,
  ctx: AuthHookContext | null,
): Promise<{ error: string; errorDescription?: string } | undefined> {
  const refusedReverify = await checkReverify(info, ctx);
  if (refusedReverify) {
    return refusedReverify;
  }
  const userId = info.user.id;
  if (!userId) {
    return undefined;
  }
  const [found] = await db
    .select({ deactivatedAt: user.deactivatedAt })
    .from(user)
    .where(eq(user.id, userId));
  if (found?.deactivatedAt) {
    return { error: ACCOUNT_DEACTIVATED.code, errorDescription: ACCOUNT_DEACTIVATED.message };
  }
  return undefined;
}

/**
 * Records a re-verify refused for another account than the user's own
 * confirmed one ({@link checkReverify}), once: nothing was connected and no
 * session created, so only the failed confirmation is recorded.
 *
 * @param ctx - The endpoint context, with its response.
 * @returns The refused re-verify, if there was one.
 */
export async function recordRefusedReverify(
  ctx: AuthHookContext,
): Promise<{ userId: string; providerId: string | null } | null> {
  const refusedReverify = takeRequestState(ctx.context, 'refusedReverify') ?? null;
  if (refusedReverify) {
    await safely('record refused re-verify', async () => {
      // An earlier attempt's notice would show next to this refusal's message: drop it.
      expireCookieIfSent(ctx, PROVIDER_STEP_UP_COOKIE);
      await audit(ctx, 'mfa_failed', refusedReverify.userId, {
        method: refusedReverify.providerId,
        reason: 'different_account',
      });
    });
  }
  return refusedReverify;
}
