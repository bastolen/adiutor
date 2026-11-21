/**
 * @file How a sign-in happened, for the audit log, worked out from the endpoint
 * that created the session.
 */
import { isMfaProvider, isOAuthProvider, type OAuthProvider } from '../../sign-in/oauth-providers';
import { REQUEST_LINK_ENDPOINT } from '../../sign-in/request-link';
import { mfaMethodFromPath } from './session';

/** How someone signed in, for the audit log. */
export type SignInMethod =
  | 'password'
  | 'password_and_authenticator'
  | 'password_and_email_code'
  | 'backup_code'
  | 'passkey'
  | 'email_link'
  | 'request_link'
  | OAuthProvider
  | 'other';

/**
 * Checks whether an endpoint proved a second step: one of the
 * endpoints that prove one ({@link mfaMethodFromPath}), or the callback of a provider that can prove
 * MFA (`MFA_PROVIDERS`) when that provider confirmed the session with the
 * account's two-factor authentication. Other providers (Google) never do.
 *
 * @param path - The endpoint's path.
 * @param providerId - For provider callbacks, which provider.
 * @param providerMfa - Whether the provider confirmed the session with its 2FA.
 * @returns Whether a second step was proven.
 */
function provesSecondStep(
  path: string,
  providerId: string | undefined,
  providerMfa: boolean,
): boolean {
  if (mfaMethodFromPath(path) !== null) {
    return true;
  }
  return providerMfa && path.startsWith('/callback/') && isMfaProvider(providerId);
}

/**
 * Works out how someone signed in from the Better Auth endpoint that
 * created their session. A second step proven by a request that already had
 * a session isn't a sign-in, as for Better Auth itself (`isSignIn`): turning
 * on two-step verification, or confirming the session with a passkey or with
 * GitHub (with its 2FA) on the step-up page, replaces the session with a new
 * one, but nobody signed in. A provider sign-in that its provider didn't
 * confirm (2FA off, the provider unreachable, the account not confirmed yet)
 * is a sign-in, with or without a session.
 *
 * @param path - The endpoint's path.
 * @param options - What else is known about the request.
 * @param options.providerId - For provider callbacks, which provider (e.g. `github`).
 * @param options.signedIn - Whether the request was made with a session.
 * @param options.providerMfa - For provider callbacks, whether the provider
 *   confirmed the new session with the account's two-factor authentication
 *   (only counts for `MFA_PROVIDERS`).
 * @returns The sign-in method, or `null` when the endpoint didn't sign
 *   anyone in (e.g. the session that replaces the old one after turning on
 *   two-step verification, or after a passkey or GitHub step-up).
 */
export function signInMethodFromPath(
  path: string | undefined,
  {
    providerId,
    signedIn = false,
    providerMfa = false,
  }: { providerId?: string; signedIn?: boolean; providerMfa?: boolean } = {},
): SignInMethod | null {
  if (signedIn && path && provesSecondStep(path, providerId, providerMfa)) {
    return null;
  }
  switch (path) {
    case '/sign-in/email':
      return 'password';
    case '/two-factor/verify-totp':
      return 'password_and_authenticator';
    case '/two-factor/verify-otp':
      return 'password_and_email_code';
    case '/two-factor/verify-backup-code':
      return 'backup_code';
    case '/passkey/verify-authentication':
      return 'passkey';
    case '/magic-link/verify':
      return 'email_link';
    case REQUEST_LINK_ENDPOINT:
      return 'request_link';
    default:
      if (path?.startsWith('/callback/')) {
        return isOAuthProvider(providerId) ? providerId : 'other';
      }
      return null;
  }
}
