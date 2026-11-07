/**
 * @file Messages of the account pages: after coming back from an email
 * verification link (shown in the Profile page's Email card) or from
 * connecting GitHub/Google (in the Security page's Connected accounts card),
 * and for a refused disconnect.
 */
import ownValue from '@/lib/own-value';
import { withSection } from '@/lib/redirect';
import getAuthErrorMessage from '@/lib/sign-in/auth-error-messages';
import { isOAuthProvider, PROVIDER_LABELS } from '@/lib/sign-in/oauth-providers';
import {
  MFA_REQUIRED_FOR_ROLE,
  SESSION_NOT_FRESH,
  SIGN_IN_CHANGE_IN_PROGRESS,
} from '@/lib/sign-in/sign-in-refusals';
import { searchParam } from '@/lib/tables/search-params';

/** A message for the form message component. */
export interface AccountMessage {
  /** `success` for confirmations, `error` for problems. */
  tone: 'success' | 'error';
  /** The text to show. */
  text: string;
}

/** The anchor of the Profile page's Email card, where verifying the address starts and ends. */
export const EMAIL_SECTION = 'email';

/**
 * Where the email verification link comes back to: the Email card on the
 * Profile page, saying it worked (Better Auth adds `error=<code>` before the
 * anchor when it didn't).
 */
export const VERIFIED_RETURN_PATH = withSection('/account?verified=1', EMAIL_SECTION);

/** Query parameters the account page reads. */
export interface AccountParams {
  /** Set by us after a successful email verification. */
  verified?: string | string[];
  /** Set by us after connecting a provider: which one. */
  connected?: string | string[];
  /** Better Auth's error code when verifying or connecting failed. */
  error?: string | string[];
}

/** Messages per Better Auth error code. */
const ERROR_MESSAGES: Record<string, string> = {
  TOKEN_EXPIRED: 'This verification link has expired. Send a new one.',
  INVALID_TOKEN: 'This verification link is invalid. Send a new one.',
  account_already_linked_to_different_user:
    'That account is already connected to another Adiutor account.',
  email_not_verified: "The provider hasn't verified that account's email address.",
};

/**
 * Works out the message from the query parameters. Better Auth appends
 * `error=<code>` to our return URL when something fails, so an error wins
 * over our success parameters.
 *
 * @param params - The page's query parameters.
 * @returns The message, or `null` when there's nothing to say.
 */
export default function accountMessage(params: AccountParams): AccountMessage | null {
  const error = searchParam(params.error);
  if (error) {
    return {
      tone: 'error',
      text: ownValue(ERROR_MESSAGES, error) ?? 'That didn’t work. Please try again.',
    };
  }
  if (params.verified) {
    return { tone: 'success', text: 'Your email address is verified.' };
  }
  const connected = searchParam(params.connected);
  if (isOAuthProvider(connected)) {
    return { tone: 'success', text: `${PROVIDER_LABELS[connected]} is now connected.` };
  }
  return null;
}

/**
 * The message for a refused disconnect.
 *
 * @param code - Better Auth's error code, if any.
 * @returns The message.
 */
export function disconnectFailureMessage(code: string | undefined): string {
  if (code === SESSION_NOT_FRESH.code) {
    return 'For your safety, sign out and in again before disconnecting.';
  }
  if (code === MFA_REQUIRED_FOR_ROLE.code) {
    return 'Your role requires MFA, and this account gives you it. Add a passkey first, then try again.';
  }
  if (code === SIGN_IN_CHANGE_IN_PROGRESS.code) {
    return getAuthErrorMessage(code) ?? 'Disconnecting failed. Please try again.';
  }
  return 'Disconnecting failed. Please try again.';
}
