/**
 * @file When emailed codes may be used as a second step: never for roles that
 * require MFA, and never once an authenticator app is set up.
 */
import { type MfaRole, requiresMfa } from './requirement';
import type { MfaState } from './state';

/**
 * Checks whether email codes may confirm a session that's already signed in
 * (the step-up page). Never with an authenticator app set up, and never for
 * roles that require MFA.
 *
 * @param state - The account's setup.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @returns Whether email codes are accepted.
 */
export function allowsEmailCodes(state: MfaState, mfaRole: MfaRole | null): boolean {
  return !state.authenticator && !requiresMfa(mfaRole);
}

/**
 * Checks whether email codes may finish a password sign-in: only when no
 * authenticator app is set up, so the inbox alone can't get past the app.
 * (For roles that require MFA such a sign-in doesn't count as MFA verified;
 * see {@link isSessionMfaVerified}.) The guards enforce it, and the code step
 * offers only the authenticator app when there is one.
 *
 * @param state - The account's setup; only `authenticator` matters.
 * @returns Whether email codes are accepted at sign-in.
 */
export function allowsEmailCodesAtSignIn(state: Pick<MfaState, 'authenticator'>): boolean {
  return !state.authenticator;
}

/**
 * Whether email codes can be set up and used (see {@link allowsEmailCodes}),
 * or why not: an authenticator app `replaced` them, or they don't count
 * (`not-for-role`).
 */
export type EmailCodeStatus = 'available' | 'replaced' | 'not-for-role';

/**
 * Tells whether email codes are available to a user, or why not, for the
 * Security page.
 *
 * @param state - The account's setup; only `authenticator` matters.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @returns The status.
 */
export function emailCodeStatus(
  state: Pick<MfaState, 'authenticator'>,
  mfaRole: MfaRole | null,
): EmailCodeStatus {
  if (state.authenticator) {
    return 'replaced';
  }
  return requiresMfa(mfaRole) ? 'not-for-role' : 'available';
}
