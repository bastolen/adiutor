/**
 * @file What the sign-in error page (`/sign-in-error`) says for Better
 * Auth's error codes, and for the auth guards' refusals of a link the browser
 * opened (e.g. `UNSAFE_RETURN_ADDRESS`, whose message comes from
 * `src/lib/sign-in/sign-in-refusals.ts` through the sign-in page's messages).
 * The code itself is never shown: the page gives a reference for admins
 * instead.
 */
import ownValue from '@/lib/own-value';
import { knownAuthErrorMessage } from '@/lib/sign-in/auth-error-messages';

/** Shown for codes without a message of their own. */
export const GENERIC_SIGN_IN_ERROR = 'Something went wrong while signing you in. Please try again.';

/** For a sign-in through a provider that took too long or got mixed up with another tab. */
const RESTART = 'The sign-in took too long, or was started in another tab. Please try again.';

/** Messages for the errors of signing in or connecting an account through a provider. */
const PROVIDER_MESSAGES: Readonly<Record<string, string>> = {
  state_mismatch: RESTART,
  please_restart_the_process: RESTART,
  invalid_callback_request: RESTART,
  access_denied: 'Signing in was cancelled at the provider. Try again, or sign in another way.',
  account_already_linked_to_different_user:
    'That account is already connected to another Adiutor account. Sign in with that account, or connect a different one.',
  unable_to_link_account: "That account couldn't be connected. Please try again.",
  "email_doesn't_match":
    "That account's email address doesn't match yours. Connect an account with your email address.",
  email_not_found:
    "The provider didn't share an email address. Check your account there, then try again.",
  unable_to_get_user_info:
    "The provider didn't share your details. Check your account there, then try again.",
};

/**
 * Says what went wrong, for the error page.
 *
 * @param code - Better Auth's error code, already checked (`cleanErrorCode`).
 * @returns The message: the provider errors', the sign-in page's for codes it knows, or a general one.
 */
export default function signInErrorMessage(code: string): string {
  const providerMessage = ownValue(PROVIDER_MESSAGES, code);
  if (providerMessage) {
    return providerMessage;
  }
  return knownAuthErrorMessage(code) ?? GENERIC_SIGN_IN_ERROR;
}
