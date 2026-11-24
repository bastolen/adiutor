/**
 * @file Whether a session counts as having had a second factor, and the
 * 15-minute window after a second step in which sign-in methods may change.
 */
import ownValue from '../../own-value';
import { isMfaProvider, MFA_PROVIDERS, type MfaProvider } from '../../sign-in/oauth-providers';
import { type MfaRole, requiresMfa } from './requirement';
import type { MfaState } from './state';
import { hasStrongerStepThanProvider } from './step-up';

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

/** A session's MFA facts, as the rules read them. */
export interface SessionMfa {
  /** Whether its sign-in, or a later step-up, had a second factor. */
  mfaVerified: boolean;
  /** Which second factor, if known. */
  mfaMethod: string | null;
  /** When it was proven, if known (Better Auth may pass a string). */
  mfaVerifiedAt: Date | string | null;
  /**
   * Whether it was started from the link in an email about a request
   * (decision 0036): it isn't sent to the step-up page (`mustStepUp`), but
   * it proved no second factor, so it opens no window for changing sign-in
   * methods, and it never counts as a fresh sign-in ({@link signedInAtOf}).
   * Missing or `null` counts as `false`; the rules about second steps don't
   * read it.
   */
  fromRequestLink?: boolean | null;
}

/** A session's MFA facts as a reader gets them: any may be missing or `null`. */
export type SessionMfaInput = { [Key in keyof SessionMfa]?: SessionMfa[Key] | null };

/**
 * Normalizes a session's MFA facts as a reader gets them (from Better Auth,
 * a hook or a query), where any may be missing, into what the rules take.
 *
 * @param raw - The session, or just its MFA fields.
 * @returns The facts, with a missing `mfaVerified` or `fromRequestLink` as
 *   `false` and missing others as `null`.
 */
export function sessionMfaOf(raw: SessionMfaInput): SessionMfa & { fromRequestLink: boolean } {
  return {
    mfaVerified: raw.mfaVerified ?? false,
    mfaMethod: raw.mfaMethod ?? null,
    mfaVerifiedAt: raw.mfaVerifiedAt ?? null,
    fromRequestLink: raw.fromRequestLink ?? false,
  };
}

/**
 * When a session signed in, for the one-hour rule (`needsFreshSignIn`): its
 * `createdAt`, except for a session started from the link in an email about
 * a request, which never counts as a fresh sign-in. That link works for 14
 * days and for whoever has the email, so it proves nothing recent: an
 * account without a second step signs in again before it adds its first way
 * in, like any old session.
 *
 * @param session - The session's sign-in time and whether a request link started it.
 * @param session.createdAt - When it signed in, if known (Better Auth may pass a string).
 * @param session.fromRequestLink - Whether the link in an email about a request started it.
 * @returns The sign-in time, or `null` when it's unknown or doesn't count.
 */
export function signedInAtOf(session: {
  createdAt?: Date | string | null;
  fromRequestLink?: boolean | null;
}): Date | null {
  if (session.fromRequestLink || !session.createdAt) {
    return null;
  }
  return new Date(session.createdAt);
}

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
 * Only the table's own entries count, never a name it inherits (such as
 * `constructor`).
 *
 * @param path - The endpoint's path, e.g. `/two-factor/verify-totp`.
 * @returns The method, or `null` when the endpoint proves none.
 */
export function mfaMethodFromPath(path: string | undefined): MfaMethod | null {
  return (path && ownValue(MFA_METHOD_PATHS, path)) || null;
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
  session: Pick<SessionMfa, 'mfaVerified' | 'mfaMethod'>,
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
  session: SessionMfa,
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
