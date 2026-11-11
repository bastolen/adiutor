/**
 * @file Strong MFA, whatever the user's role: what starting to sign in as
 * someone else asks of the staff member who starts it. They need MFA that
 * counts for the roles that require it (not email codes), and a confirmation
 * with it from the last 15 minutes, also when their own role (Support)
 * doesn't require MFA. See docs/decisions/0017-staff-sign-in-as-users.md.
 */
import type { MfaRole } from './requirement';
import { mfaConfirmedUntil, type SessionMfa } from './session';
import { hasMfa, type MfaState, type ProviderAvailability } from './state';

/**
 * The MFA role whose rules the strong checks apply. Every role that requires
 * MFA (`requiresMfa`) has the same rules, so any of them gives the same
 * answers; this one is named only so the checks below can ask those rules.
 */
const STRONG_MFA_ROLE = 'platform_admin' satisfies MfaRole;

/**
 * Checks whether an account has MFA that counts for the roles that require
 * it: an authenticator app, a passkey, or no password with every connected
 * provider account protected with MFA itself. Email codes don't count, even
 * for a role that would otherwise accept them.
 *
 * @param state - The account's setup.
 * @param available - The configured providers that can prove MFA.
 * @returns Whether it has strong MFA.
 */
export function hasStrongMfa(state: MfaState, available: ProviderAvailability): boolean {
  return hasMfa(state, STRONG_MFA_ROLE, available);
}

/**
 * Works out until when a session counts as recently confirmed with a strong
 * second step: 15 minutes after its sign-in or step-up with one, judged as
 * for a role that requires MFA (see `mfaConfirmedUntil`). An email code or a
 * trusted device never opens it, and GitHub doesn't on an account with a
 * passkey or an authenticator app.
 *
 * @param session - The session's MFA facts.
 * @param state - The account's setup now.
 * @returns The end of that window, or `null` when the session has none.
 */
export function strongMfaConfirmedUntil(session: SessionMfa, state: MfaState): Date | null {
  return mfaConfirmedUntil(session, STRONG_MFA_ROLE, state);
}
