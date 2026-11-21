/**
 * @file Messages of the account pages: after coming back from an email
 * verification link (shown in the Profile page's Email card) or from
 * connecting GitHub/Google (in the Security page's Connected accounts card),
 * and for a refused disconnect, in the reader's language (`account.messages`).
 */
import type { useTranslations } from 'next-intl';

import { withSection } from '@/lib/redirect';
import { searchParam } from '@/lib/search-params';
import { type AuthTranslator, signInErrorText } from '@/lib/sign-in/auth-error-messages';
import { isOAuthProvider, PROVIDER_LABELS } from '@/lib/sign-in/oauth-providers';
import {
  MFA_REQUIRED_FOR_ROLE,
  SESSION_NOT_FRESH,
  SIGN_IN_CHANGE_IN_PROGRESS,
} from '@/lib/sign-in/sign-in-refusals';

import { providerErrorMessage } from '../../sign-in-error/messages';

/** A message for the form message component. */
export interface AccountMessage {
  /** `success` for confirmations, `error` for problems. */
  tone: 'success' | 'error';
  /** The text to show. */
  text: string;
}

/** The anchor of the Profile page's Email card, where verifying the address starts and ends. */
export const EMAIL_SECTION = 'email';

/** The anchor of the Profile page's Language card, where the page reloads after a change. */
export const LANGUAGE_SECTION = 'language';

/** The anchor of the Profile page's Time zone card, where the page reloads after a change. */
export const TIME_ZONE_SECTION = 'time-zone';

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
  /** Set by us after saving the language (`saved`), once the page reloaded in it. */
  language?: string | string[];
  /** Set by us after saving the time zone (`saved`), once the page reloaded in it. */
  timeZone?: string | string[];
}

/**
 * Explains Better Auth's error code after verifying an address or connecting
 * an account failed.
 *
 * @param t - Translates the `account` namespace (`useTranslations` or `getTranslations`).
 * @param tAuth - Translates the `auth` namespace, for the provider errors.
 * @param code - The code.
 * @returns The message; a general one for codes without their own.
 */
function errorText(
  t: ReturnType<typeof useTranslations<'account'>>,
  tAuth: AuthTranslator,
  code: string,
): string {
  switch (code) {
    case 'TOKEN_EXPIRED':
      return t('messages.verificationExpired');
    case 'INVALID_TOKEN':
      return t('messages.verificationInvalid');
    case 'email_not_verified':
      return t('messages.emailNotVerified');
    default:
      return providerErrorMessage(tAuth, code) ?? t('messages.failed');
  }
}

/**
 * Works out the message from the query parameters. Better Auth appends
 * `error=<code>` to our return URL when something fails, so an error wins
 * over our success parameters.
 *
 * @param t - Translates the `account` namespace (`useTranslations` or `getTranslations`).
 * @param tAuth - Translates the `auth` namespace, for Better Auth's provider errors.
 * @param params - The page's query parameters.
 * @returns The message, or `null` when there's nothing to say.
 */
export default function accountMessage(
  t: ReturnType<typeof useTranslations<'account'>>,
  tAuth: AuthTranslator,
  params: AccountParams,
): AccountMessage | null {
  const error = searchParam(params.error);
  if (error) {
    return { tone: 'error', text: errorText(t, tAuth, error) };
  }
  if (params.verified) {
    return { tone: 'success', text: t('messages.verified') };
  }
  const connected = searchParam(params.connected);
  if (isOAuthProvider(connected)) {
    return {
      tone: 'success',
      text: t('messages.connected', { provider: PROVIDER_LABELS[connected] }),
    };
  }
  return null;
}

/**
 * The message for a refused disconnect.
 *
 * @param t - Translates the `account` namespace (`useTranslations` or `getTranslations`).
 * @param tAuth - Translates the `auth` namespace, for a sign-in change still in progress.
 * @param code - Better Auth's error code, if any.
 * @returns The message.
 */
export function disconnectFailureMessage(
  t: ReturnType<typeof useTranslations<'account'>>,
  tAuth: AuthTranslator,
  code: string | undefined,
): string {
  if (code === SESSION_NOT_FRESH.code) {
    return t('messages.disconnectNotFresh');
  }
  if (code === MFA_REQUIRED_FOR_ROLE.code) {
    return t('messages.disconnectMfaRequired');
  }
  if (code === SIGN_IN_CHANGE_IN_PROGRESS.code) {
    return signInErrorText(tAuth, code) ?? t('messages.disconnectFailed');
  }
  return t('messages.disconnectFailed');
}
