/**
 * @file Limits on attempts: wrong passwords per address, wrong current passwords
 * and wrong step-up codes per user, and emailed codes per address or user,
 * counted before the check and settled by the reactions after the request.
 */
import { createHash } from 'node:crypto';

import { APIError } from 'better-auth/api';

import { db } from '@/db';
import { EMAIL_CODE_RESEND_SECONDS } from '@/lib/authz/mfa';
import { EMAIL_CODE_SENT_RECENTLY } from '@/lib/sign-in/sign-in-refusals';

import {
  hitRateLimit,
  RATE_LIMITS,
  type RateLimitRule,
  releaseRateLimitHit,
  resetRateLimit,
} from '../../rate-limit';
import { hasPassword } from '../accounts';
import { wrongCurrentPasswordsKey } from '../current-password';
import { failedSignInsKey } from '../failed-sign-ins';
import { requestState, takeRequestState } from '../request-state';
import type { AuthGuardContext } from './paths';
import { passwordSignInPausedBody, refusalBody, tooManyAttemptsBody } from './refusal-messages';

/** The limits applied here. */
export const AUTH_GUARD_LIMITS = {
  /** Wrong passwords per email address. */
  failedSignInsPerEmail: { limit: 10, windowSeconds: 15 * 60 },
  /** Email links and password reset emails per email address. */
  emailsPerAddress: { limit: 5, windowSeconds: 60 * 60 },
  /** Wrong codes when confirming a signed-in session, per user. */
  failedStepUpsPerUser: { limit: 5, windowSeconds: 15 * 60 },
  /** Email codes sent, per user (not counting setting up email codes). */
  emailCodesPerUser: { limit: 5, windowSeconds: 15 * 60 },
  /**
   * One emailed code per challenge per half a code's lifetime, setting up
   * included: a new one can't be asked for while the last still works for a
   * while. A challenge is what Better Auth keeps the code with, a pending
   * sign-in or a signed-in session ({@link signInCodeChallenge},
   * {@link sessionCodeChallenge}), so another sign-in or session, which the
   * last code can't be used for, never waits for it. Using a code ends its
   * session's wait (`endEmailCodeCooldown`).
   */
  emailCodeCooldown: { limit: 1, windowSeconds: EMAIL_CODE_RESEND_SECONDS },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Rate limit keys. Other modules settle failures through `settlePasswordAttempt`,
 * `settleCurrentPasswordAttempt` and `settleStepUpAttempt` (and lift a pause with
 * `clearFailedSignIns`) rather than using the keys directly.
 */
const KEYS = {
  /**
   * Wrong passwords for an address.
   *
   * @param email - The lower-cased address.
   * @returns The key.
   */
  failedSignIns: failedSignInsKey,
  /**
   * Wrong current passwords of a user, the password forms' bucket
   * (`checkCurrentPassword`).
   *
   * @param userId - The user.
   * @returns The key.
   */
  wrongCurrentPasswords: wrongCurrentPasswordsKey,
  /**
   * Wrong step-up codes of a user.
   *
   * @param userId - The user.
   * @returns The key.
   */
  failedStepUps: (userId: string) => `step-up-failed:user:${userId}`,
  /**
   * Email codes sent to a user.
   *
   * @param userId - The user.
   * @returns The key.
   */
  emailCodes: (userId: string) => `email-code:user:${userId}`,
  /**
   * The wait before another emailed code may be asked for in a challenge.
   *
   * @param challenge - The challenge ({@link signInCodeChallenge}, {@link sessionCodeChallenge}).
   * @returns The key.
   */
  emailCodeCooldown: (challenge: string) => `email-code-cooldown:${challenge}`,
};

/**
 * Names a pending sign-in's code step as the challenge an emailed code
 * belongs to: Better Auth keeps the code with the sign-in's two-factor
 * cookie. The identifier is hashed, since it's what lets the sign-in finish
 * and mustn't be stored as it is.
 *
 * @param identifier - The pending sign-in's identifier (its signed two-factor cookie's value).
 * @returns The challenge.
 */
export function signInCodeChallenge(identifier: string): string {
  return `sign-in:${createHash('sha256').update(identifier).digest('base64url')}`;
}

/**
 * Names a signed-in session as the challenge an emailed code belongs to (the
 * step-up page, setting up email codes): Better Auth keeps the code with the
 * user and the session.
 *
 * @param sessionId - The session's ID.
 * @returns The challenge.
 */
export function sessionCodeChallenge(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Refuses a request for a used-up limit, saying how long to wait in the
 * request's language.
 *
 * @param ctx - The endpoint context.
 * @param retryAfterSeconds - When the window resets.
 * @throws {APIError} `TOO_MANY_REQUESTS` with code `TOO_MANY_ATTEMPTS`.
 */
function tooManyAttempts(ctx: AuthGuardContext, retryAfterSeconds: number): never {
  throw new APIError('TOO_MANY_REQUESTS', tooManyAttemptsBody(ctx, retryAfterSeconds));
}

/**
 * Counts a hit and refuses the request when the limit is reached (for
 * requests that send an email, which count whether or not they succeed).
 *
 * @param ctx - The endpoint context.
 * @param key - What's limited.
 * @param rule - The limit.
 * @throws {APIError} `TOO_MANY_REQUESTS` with code `TOO_MANY_ATTEMPTS`.
 */
export async function limit(
  ctx: AuthGuardContext,
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  const { allowed, retryAfterSeconds } = await hitRateLimit({ db }, key, rule);
  if (!allowed) {
    tooManyAttempts(ctx, retryAfterSeconds);
  }
}

/**
 * Lets an emailed code through only once the wait since the challenge's last
 * one is over (`EMAIL_CODE_RESEND_SECONDS`), and counts it towards the user's
 * limit unless they're setting up email codes. The wait is per challenge, as
 * Better Auth keeps the code: another sign-in or session gets a code of its
 * own at once, and the user's limit still caps them all. The wait comes
 * first, so a refused request doesn't use up one of the codes.
 *
 * @param ctx - The endpoint context.
 * @param userId - Who the code is for.
 * @param counted - Whether it counts towards the user's limit of email codes.
 * @param challenge - What the code belongs to ({@link signInCodeChallenge},
 *   {@link sessionCodeChallenge}).
 * @throws {APIError} `TOO_MANY_REQUESTS`: `EMAIL_CODE_SENT_RECENTLY` within the wait,
 *   `TOO_MANY_ATTEMPTS` past the limit.
 */
export async function limitEmailCode(
  ctx: AuthGuardContext,
  userId: string,
  counted: boolean,
  challenge: string,
): Promise<void> {
  const { allowed } = await hitRateLimit(
    { db },
    KEYS.emailCodeCooldown(challenge),
    AUTH_GUARD_LIMITS.emailCodeCooldown,
  );
  if (!allowed) {
    throw new APIError('TOO_MANY_REQUESTS', refusalBody(ctx, EMAIL_CODE_SENT_RECENTLY.code));
  }
  if (counted) {
    await limit(ctx, KEYS.emailCodes(userId), AUTH_GUARD_LIMITS.emailCodesPerUser);
  }
}

/**
 * Ends a session's wait for a new emailed code once its last one was used
 * (the after hook, for a code Better Auth accepted): the session may need
 * another code for its next confirmation. A sign-in's code needs no such
 * end, since its challenge ends with the sign-in. The number of codes per
 * user (`emailCodesPerUser`) is never reset here.
 *
 * @param challenge - Whose wait ends ({@link sessionCodeChallenge}).
 */
export async function endEmailCodeCooldown(challenge: string): Promise<void> {
  await resetRateLimit(db, KEYS.emailCodeCooldown(challenge));
}

/**
 * Counts a wrong password for an address, for a failed sign-in that took no
 * attempt beforehand (and for tests).
 *
 * @param email - The address, a plausible one (`plausibleEmail`).
 * @returns Whether this one paused password sign-in for the address.
 */
export async function countFailedSignIn(email: string): Promise<boolean> {
  const { hits } = await hitRateLimit(
    { db },
    KEYS.failedSignIns(email),
    AUTH_GUARD_LIMITS.failedSignInsPerEmail,
  );
  return hits === AUTH_GUARD_LIMITS.failedSignInsPerEmail.limit;
}

/**
 * Takes one of an address's wrong-password attempts before its password is
 * checked, so requests sent at the same moment can't all get past the limit
 * (one atomic count, not a check and a later count). Refuses the sign-in once
 * they're used up: the message is the same for every address, whether or not
 * it has an account, says how long the pause lasts and points to the ways in
 * that still work.
 *
 * @param ctx - The endpoint context.
 * @param email - The address, trimmed and lower-cased, and a plausible one (`plausibleEmail`):
 *   whatever else a client sends never becomes a key.
 * @throws {APIError} `TOO_MANY_REQUESTS` with code `PASSWORD_SIGN_IN_PAUSED`.
 */
export async function reservePasswordAttempt(ctx: AuthGuardContext, email: string): Promise<void> {
  const rule = AUTH_GUARD_LIMITS.failedSignInsPerEmail;
  const { hits, retryAfterSeconds } = await hitRateLimit({ db }, KEYS.failedSignIns(email), rule);
  if (hits > rule.limit) {
    throw new APIError('TOO_MANY_REQUESTS', passwordSignInPausedBody(ctx, retryAfterSeconds));
  }
  requestState(ctx.context).reservedPasswordAttempt = { email, hits };
}

/**
 * Settles the attempt a password sign-in took (called after it): a wrong
 * password keeps it, anything else (the right password, or a request Better
 * Auth refused before checking one) gives it back. Without one taken (it
 * shouldn't happen), a wrong password is counted now.
 *
 * @param ctx - The endpoint context (its `context` is shared with the checks before).
 * @param ctx.context - Better Auth's request state.
 * @param email - The plausible address (`plausibleEmail`), if any.
 * @param wrongPassword - Whether Better Auth refused the email and password.
 * @returns Whether this sign-in paused password sign-in for the address:
 *   once per window, as sign-ins refused while paused never get that far.
 */
export async function settlePasswordAttempt(
  ctx: { context: object },
  email: string | null,
  wrongPassword: boolean,
): Promise<boolean> {
  const reserved = takeRequestState(ctx.context, 'reservedPasswordAttempt');
  if (!reserved) {
    return wrongPassword && email ? countFailedSignIn(email) : false;
  }
  if (wrongPassword) {
    return reserved.hits === AUTH_GUARD_LIMITS.failedSignInsPerEmail.limit;
  }
  await releaseRateLimitHit({ db }, KEYS.failedSignIns(reserved.email));
  return false;
}

/**
 * Counts a wrong code on the step-up page, for a failed check that took no
 * attempt beforehand (codes entered while setting up two-step verification).
 *
 * @param userId - The user.
 */
async function countFailedStepUp(userId: string): Promise<void> {
  await hitRateLimit({ db }, KEYS.failedStepUps(userId), AUTH_GUARD_LIMITS.failedStepUpsPerUser);
}

/**
 * Takes one of a user's wrong-code attempts on the step-up page before the
 * code is checked (one atomic count), so codes sent at the same moment can't
 * all get past the limit. Refuses the check once they're used up.
 *
 * @param ctx - The endpoint context.
 * @param userId - The signed-in user.
 * @throws {APIError} `TOO_MANY_REQUESTS` with code `TOO_MANY_ATTEMPTS`.
 */
export async function reserveStepUpAttempt(ctx: AuthGuardContext, userId: string): Promise<void> {
  const rule = AUTH_GUARD_LIMITS.failedStepUpsPerUser;
  const { hits, retryAfterSeconds } = await hitRateLimit({ db }, KEYS.failedStepUps(userId), rule);
  if (hits > rule.limit) {
    tooManyAttempts(ctx, retryAfterSeconds);
  }
  requestState(ctx.context).reservedStepUpAttempt = userId;
}

/**
 * Settles the attempt a step-up code check took (called after it): a wrong
 * code keeps it; anything else gives it back (a right code, or a request
 * Better Auth refused without comparing a code, such as an expired email
 * code). A wrong code that took none (setting up two-step verification) is
 * counted now.
 *
 * @param ctx - The endpoint context (its `context` is shared with the checks before).
 * @param ctx.context - Better Auth's request state.
 * @param userId - The signed-in user.
 * @param wrongCode - Whether Better Auth refused the code as wrong (401).
 */
export async function settleStepUpAttempt(
  ctx: { context: object },
  userId: string,
  wrongCode: boolean,
): Promise<void> {
  const reserved = takeRequestState(ctx.context, 'reservedStepUpAttempt');
  if (!reserved) {
    if (wrongCode) {
      await countFailedStepUp(userId);
    }
    return;
  }
  if (!wrongCode) {
    await releaseRateLimitHit({ db }, KEYS.failedStepUps(reserved));
  }
}

/**
 * Takes one of a user's wrong-current-password attempts before Better Auth
 * checks their current password (`CURRENT_PASSWORD_PATHS`: turning two-step
 * verification on or off, new backup codes), from the same bucket as the
 * password forms (`checkCurrentPassword`, `RATE_LIMITS.wrongCurrentPasswordsPerUser`):
 * one atomic count, so checks sent at the same moment can't all get past the
 * limit. Refuses the request once they're used up. A user without a password
 * isn't asked for one (`allowPasswordless`), so takes none.
 *
 * @param ctx - The endpoint context.
 * @param userId - The signed-in user.
 * @throws {APIError} `TOO_MANY_REQUESTS` with code `TOO_MANY_ATTEMPTS`.
 */
export async function reserveCurrentPasswordAttempt(
  ctx: AuthGuardContext,
  userId: string,
): Promise<void> {
  if (!(await hasPassword(db, userId))) {
    return;
  }
  const { allowed, retryAfterSeconds } = await hitRateLimit(
    { db },
    KEYS.wrongCurrentPasswords(userId),
    RATE_LIMITS.wrongCurrentPasswordsPerUser,
  );
  if (!allowed) {
    tooManyAttempts(ctx, retryAfterSeconds);
  }
  requestState(ctx.context).reservedCurrentPasswordAttempt = userId;
}

/**
 * Settles the attempt a current-password check through Better Auth took
 * (called after it): a wrong password keeps it; anything else gives it back
 * (the right password, or a request Better Auth refused before checking
 * one). A wrong password that took none (it shouldn't happen) is counted now.
 *
 * @param ctx - The endpoint context (its `context` is shared with the checks before).
 * @param ctx.context - Better Auth's request state.
 * @param userId - The signed-in user.
 * @param wrongPassword - Whether Better Auth refused the current password (`INVALID_PASSWORD`).
 */
export async function settleCurrentPasswordAttempt(
  ctx: { context: object },
  userId: string,
  wrongPassword: boolean,
): Promise<void> {
  const reserved = takeRequestState(ctx.context, 'reservedCurrentPasswordAttempt');
  if (!reserved) {
    if (wrongPassword) {
      await hitRateLimit(
        { db },
        KEYS.wrongCurrentPasswords(userId),
        RATE_LIMITS.wrongCurrentPasswordsPerUser,
      );
    }
    return;
  }
  if (!wrongPassword) {
    await releaseRateLimitHit({ db }, KEYS.wrongCurrentPasswords(reserved));
  }
}
