/**
 * @file What the sign-in error page (`/sign-in-error`) says for Better
 * Auth's error codes, and for the auth guards' refusals of a link the browser
 * opened (e.g. `UNSAFE_RETURN_ADDRESS`, through the sign-in page's messages
 * by code), in the reader's language. The code itself is never shown: the
 * page gives a reference for admins instead.
 */
import type { Messages } from '@/lib/i18n/messages';
import ownValue from '@/lib/own-value';
import { type AuthTranslator, knownAuthErrorText } from '@/lib/sign-in/auth-error-messages';

/** The message keys of the provider errors (`auth.codes.providers`). */
type ProviderErrorKey = keyof Messages['auth']['codes']['providers'];

/**
 * The errors of signing in or connecting an account through a provider, by
 * Better Auth's code: a sign-in that took too long or got mixed up with
 * another tab (`restart`), one cancelled at the provider, and accounts that
 * couldn't be connected.
 */
const PROVIDER_ERRORS: Readonly<Record<string, ProviderErrorKey>> = {
  state_mismatch: 'restart',
  please_restart_the_process: 'restart',
  invalid_callback_request: 'restart',
  access_denied: 'accessDenied',
  account_already_linked_to_different_user: 'linkedToOther',
  unable_to_link_account: 'unableToLink',
  "email_doesn't_match": 'emailMismatch',
  email_not_found: 'emailNotFound',
  unable_to_get_user_info: 'noUserInfo',
};

/**
 * Says what went wrong, for the error page.
 *
 * @param t - Translates the `auth` namespace.
 * @param code - Better Auth's error code, already checked (`cleanErrorCode`).
 * @returns The message: the provider errors', the sign-in page's for codes it
 *   knows, or a general one ("Something went wrong while signing you in. …").
 */
export default function signInErrorMessage(t: AuthTranslator, code: string): string {
  const providerError = ownValue(PROVIDER_ERRORS, code);
  if (providerError) {
    return t(`codes.providers.${providerError}`);
  }
  return knownAuthErrorText(t, code) ?? t('codes.errorPageFallback');
}
