/**
 * @file Whether a session counts as having had a second factor, and the
 * 15-minute window after a second step in which sign-in methods may change.
 */
import { type MfaRole, requiresMfa } from './requirement';
import type { MfaState } from './state';
import { hasStrongerStepThanProvider } from './step-up';
import { isMfaProvider, MFA_PROVIDERS, type MfaProvider } from '../../sign-in/oauth-providers';

/**
 * How a session's second factor was proven:
 * - `authenticator`, `email_code`, `backup_code`: the code step (after a
 *   password, or on the step-up page);
 * - `passkey`: a passkey sign-in (user verification is enforced);
 * - a provider ID (`github`): a sign-in with a provider that can prove MFA,
 *   whose account has two-factor authentication;
 * - `trusted_device`: a password sign-in on a device trusted after an
 *   earlier code step.
 */
export type MfaMethod =
  'authenticator' | 'email_code' | 'backup_code' | 'passkey' | 'trusted_device' | MfaProvider;

/** The second-factor method of each Better Auth endpoint that proves one. */
const MFA_METHOD_PATHS: Record<string, MfaMethod> = {
  '/two-factor/verify-totp': 'authenticator',
  '/two-factor/verify-otp': 'email_code',
  '/two-factor/verify-backup-code': 'backup_code',
  '/passkey/verify-authentication': 'passkey',
};

/**
 * Works out which second factor a Better Auth endpoint proves. Sign-ins with
 * a provider that can prove MFA are upgraded afterwards when the provider
 * account has it, since that needs a call to the provider.
 *
 * @param path - The endpoint's path, e.g. `/two-factor/verify-totp`.
 * @returns The method, or `null` when the endpoint proves none.
 */
export function mfaMethodFromPath(path: string | undefined): MfaMethod | null {
  return (path && MFA_METHOD_PATHS[path]) || null;
}

/**
 * Second factors that count for roles that require MFA. A sign-in with a
 * provider counts whether or not that provider is still configured: it was a
 * real second factor when it happened.
 */
const STRONG_METHODS: readonly MfaMethod[] = [
  'authenticator',
  'backup_code',
  'passkey',
  ...MFA_PROVIDERS,
];

/**
 * Checks whether a session counts as MFA verified for its user. For roles
 * that require MFA only strong second factors count: not email codes, and not
 * a trusted device (which may have been trusted after an email code).
 *
 * @param session - The session's MFA facts.
 * @param session.mfaVerified - Whether its sign-in, or a later step-up, had a second factor.
 * @param session.mfaMethod - Which second factor, if known.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @returns Whether it counts as verified.
 */
export function isSessionMfaVerified(
  session: { mfaVerified: boolean; mfaMethod: string | null },
  mfaRole: MfaRole | null,
): boolean {
  if (!session.mfaVerified) {
    return false;
  }
  if (!requiresMfa(mfaRole)) {
    return true;
  }
  return STRONG_METHODS.includes(session.mfaMethod as MfaMethod);
}

/**
 * How long a confirmation with a second step allows changes to how the user
 * signs in (passkeys, connected accounts, two-step verification, backup
 * codes): 15 minutes. After that the step-up page asks again.
 */
export const RECENT_MFA_MS = 15 * 60 * 1000;

/**
 * Works out until when a session may change how the user signs in:
 * {@link RECENT_MFA_MS} after its sign-in or step-up with a second factor
 * that counts for the user ({@link isSessionMfaVerified}). A trusted device
 * isn't a confirmation, since nothing was proven at that sign-in. Nor is a
 * provider that can prove MFA (GitHub) when the account has a passkey or an
 * authenticator app ({@link hasStrongerStepThanProvider}): it only says its
 * account has two-factor authentication, so whoever has a browser signed in
 * there could otherwise add a way in of their own. The session still counts
 * as confirmed, and an account whose only strong step is the provider keeps
 * the window, or it could never change anything.
 *
 * @param session - The session's MFA facts.
 * @param session.mfaVerified - Whether its sign-in, or a later step-up, had a second factor.
 * @param session.mfaMethod - Which second factor, if known.
 * @param session.mfaVerifiedAt - When that second factor was proven, if known.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param state - The account's setup now (for {@link hasStrongerStepThanProvider}).
 * @returns The end of that window, or `null` when the session has no confirmation.
 */
export function mfaConfirmedUntil(
  session: { mfaVerified: boolean; mfaMethod: string | null; mfaVerifiedAt: Date | string | null },
  mfaRole: MfaRole | null,
  state: MfaState,
): Date | null {
  if (!session.mfaVerifiedAt || session.mfaMethod === 'trusted_device') {
    return null;
  }
  if (!isSessionMfaVerified(session, mfaRole)) {
    return null;
  }
  if (isMfaProvider(session.mfaMethod) && hasStrongerStepThanProvider(state)) {
    return null;
  }
  return new Date(new Date(session.mfaVerifiedAt).getTime() + RECENT_MFA_MS);
}

/**
 * Checks whether a confirmation window (see {@link mfaConfirmedUntil}) is
 * still open, so the session may change how the user signs in.
 *
 * @param until - The end of the window, or `null`.
 * @param now - The current time.
 * @returns Whether it's still open.
 */
export function isMfaConfirmedRecently(until: Date | null, now: Date = new Date()): boolean {
  return until !== null && until.getTime() > now.getTime();
}
