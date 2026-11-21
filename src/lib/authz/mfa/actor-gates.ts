/**
 * @file What a signed-in user must do first: set up MFA, confirm their session,
 * confirm again recently, or sign in again.
 */
import { isMfaConfirmedRecently } from './session';

/**
 * A signed-in user's MFA facts as `getActor()` loads them (the matching
 * fields of `Actor` in `src/server/actor.ts`), for the rules below.
 */
export interface ActorMfa {
  /** Whether the account meets the MFA rules ({@link hasMfa}). */
  mfaEnabled: boolean;
  /** Whether the user's role requires MFA ({@link requiresMfa}). */
  mfaRequired: boolean;
  /** Whether the user has a second step to confirm sessions with ({@link canConfirmSessions}). */
  canConfirmSessions: boolean;
  /** Whether this session's sign-in, or a later step-up, counts ({@link isSessionMfaVerified}). */
  sessionMfaVerified: boolean;
  /**
   * Whether this session was started from the link in an email about a
   * request (`SessionMfa.fromRequestLink`), which is never sent to the
   * step-up page ({@link mustStepUp}).
   */
  fromRequestLink: boolean;
  /** Until when this session may change sign-in methods ({@link mfaConfirmedUntil}). */
  mfaConfirmedUntil: Date | null;
  /**
   * When this session signed in (Better Auth's `session.createdAt`), or
   * `null` outside a request or when unknown ({@link needsFreshSignIn}).
   */
  signedInAt: Date | null;
}

/**
 * Checks whether a user must set up MFA before they continue: their role
 * requires it, and they have none they can use here (provider MFA doesn't
 * count while that provider's sign-in is off).
 *
 * @param actor - The user's MFA facts.
 * @returns Whether they're sent to set it up.
 */
export function mustSetUpMfa(
  actor: Pick<ActorMfa, 'mfaRequired' | 'mfaEnabled' | 'canConfirmSessions'>,
): boolean {
  return actor.mfaRequired && !(actor.mfaEnabled && actor.canConfirmSessions);
}

/**
 * Checks whether a session must be confirmed with a second step before the
 * user continues anywhere: anyone with MFA who signed in without a second
 * factor that counts (e.g. with an email link), and also users whose role
 * requires MFA whose only second step doesn't count yet (a provider next to
 * a password), so whoever set that password can't set MFA up for them.
 *
 * Never a session started from the link in an email about a request
 * (decision 0036): that link signs its recipient in for normal use, whatever
 * their role. It proved no second factor, so every change that needs a
 * recent confirmation still asks for one straight away
 * ({@link needsRecentConfirmation}, `mfaConfirmedUntil`), and so does
 * setting up MFA when the role requires it ({@link mustSetUpMfa} still
 * applies).
 *
 * @param actor - The user's MFA facts.
 * @returns Whether they're sent to the step-up page.
 */
export function mustStepUp(
  actor: Pick<
    ActorMfa,
    'canConfirmSessions' | 'mfaEnabled' | 'mfaRequired' | 'sessionMfaVerified' | 'fromRequestLink'
  >,
): boolean {
  return (
    !actor.fromRequestLink &&
    actor.canConfirmSessions &&
    (actor.mfaEnabled || actor.mfaRequired) &&
    !actor.sessionMfaVerified
  );
}

/**
 * Checks whether changing how a user signs in (passkeys, connected
 * accounts, two-step verification, backup codes, a first password) needs a
 * fresh confirmation first: once the account has a second step, until the
 * session confirmed with it in the last 15 minutes ({@link RECENT_MFA_MS};
 * with a provider only when the account has no passkey or authenticator app,
 * see {@link mfaConfirmedUntil}). Accounts without one need a fresh sign-in
 * instead ({@link needsFreshSignIn}).
 *
 * @param actor - The user's MFA facts.
 * @param now - The current time.
 * @returns Whether the change must wait for the step-up page.
 */
export function needsRecentConfirmation(
  actor: Pick<ActorMfa, 'canConfirmSessions' | 'mfaConfirmedUntil'>,
  now: Date = new Date(),
): boolean {
  return actor.canConfirmSessions && !isMfaConfirmedRecently(actor.mfaConfirmedUntil, now);
}

/**
 * How recent a sign-in must be for a change to how the user signs in on an
 * account without a second step (see {@link needsFreshSignIn}): an hour.
 */
export const FRESH_SIGN_IN_MS = 60 * 60 * 1000;

/**
 * Checks whether a change to how a user signs in needs a fresh sign-in
 * first: on an account without a second step ({@link canConfirmSessions}),
 * there's nothing to confirm with ({@link needsRecentConfirmation} lets it
 * through), so the session must have signed in within the last hour
 * ({@link FRESH_SIGN_IN_MS}). Otherwise an old (stolen) session could add the
 * account's first way in. A sign-in time that's missing (or unreadable)
 * counts as too old.
 *
 * @param actor - The user's MFA facts.
 * @param now - The current time.
 * @returns Whether the change must wait for a new sign-in.
 */
export function needsFreshSignIn(
  actor: Pick<ActorMfa, 'canConfirmSessions' | 'signedInAt'>,
  now: Date = new Date(),
): boolean {
  if (actor.canConfirmSessions) {
    return false;
  }
  const signedInAt = actor.signedInAt === null ? Number.NaN : actor.signedInAt.getTime();
  // Written so that an unknown time (NaN) fails the check rather than passing it.
  return !(now.getTime() - signedInAt < FRESH_SIGN_IN_MS);
}
