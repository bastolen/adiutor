/**
 * @file User-facing messages for sign-in error codes, shared by the sign-in
 * pages, the step-up page, the sign-in error page and the account pages.
 * Pure and client-safe.
 *
 * Better Auth redirects back to the sign-in page with `?error=<code>` when an
 * OAuth or magic link sign-in fails, and returns codes from passkey and
 * second-step requests. The refusals of the auth guards come from
 * `./sign-in-refusals`, so their codes are declared once.
 *
 * The functions take the `auth` namespace's translator and give the message
 * in the reader's language (`auth.codes` in the catalogues), never Better
 * Auth's English. Refusals the server words itself (`SERVER_WORDED_CODES`)
 * are shown as they come. See docs/authentication.md, "How refusals reach
 * the user".
 */
import type { Messages } from '@/lib/i18n/messages';
import { PASSKEY_NAME_MAX_LENGTH } from '@/lib/input-rules';
import ownValue from '@/lib/own-value';

import { isMfaProvider, PROVIDER_LABELS } from './oauth-providers';
import {
  isServerWorded,
  MFA_REQUIRED_FOR_ROLE,
  REVERIFY_WRONG_ACCOUNT,
  SIGN_IN_CHANGE_IN_PROGRESS,
} from './sign-in-refusals';

/**
 * Codes the step-up page shows as `REVERIFY_WRONG_ACCOUNT` after "Confirm
 * with GitHub" ({@link reverifyErrorText}): the refusal itself, and Better
 * Auth's own answers for an account it couldn't sign in with (no Adiutor
 * account with that address, or one it wouldn't connect), which would
 * otherwise tell whether an address has an Adiutor account. Either way, it
 * wasn't the user's own confirmed account.
 */
const REVERIFY_REFUSALS = new Set<string>([
  REVERIFY_WRONG_ACCOUNT.code,
  'signup_disabled',
  'account_not_linked',
]);

/** Refusals of a sign-in change that say what to do (the rule for the role, another change still running). */
const SIGN_IN_CHANGE_REFUSALS = new Set<string>([
  MFA_REQUIRED_FOR_ROLE.code,
  SIGN_IN_CHANGE_IN_PROGRESS.code,
]);

/** The messages chosen by a code: `auth.codes` in the catalogues. */
type CodeMessages = Messages['auth']['codes'];

/** An error code with a message of its own (`auth.codes.errors`). */
export type AuthErrorCode = keyof CodeMessages['errors'];

/** The message key of a sign-in notice (`auth.codes.notices`). */
type NoticeKey = keyof CodeMessages['notices'];

/** The message key of a provider's sign-in error (`auth.codes.providers`). */
type ProviderErrorKey = keyof CodeMessages['providers'];

/** The keys of the `auth` namespace that the functions below translate. */
export type AuthCodeKey =
  | 'codes.fallback'
  | 'codes.tooManyRequests'
  | 'codes.reverifyWrongAccount'
  | 'codes.errorPageFallback'
  | `codes.errors.${AuthErrorCode}`
  | `codes.notices.${NoticeKey}`
  | `codes.providers.${ProviderErrorKey}`;

/**
 * Translates the `auth` namespace: `useTranslations('auth')` in a
 * component, `await getTranslations('auth')` on a server page, and
 * `translator(locale, 'auth')` outside a request (the auth guards).
 */
export type AuthTranslator = (key: AuthCodeKey, values?: Record<string, string | number>) => string;

/**
 * Every code in `auth.codes.errors`, with the values its message takes (or
 * `null`). TypeScript checks it against the English (US) catalogue, so a
 * code can't miss a message, nor a message its code.
 */
const ERROR_CODE_VALUES: Readonly<Record<AuthErrorCode, Readonly<Record<string, number>> | null>> =
  {
    signup_disabled: null,
    new_user_signup_disabled: null,
    account_not_linked: null,
    INVALID_TOKEN: null,
    expired_token: null,
    AUTH_CANCELLED: null,
    PASSKEY_NOT_FOUND: null,
    INVALID_CODE: null,
    INVALID_BACKUP_CODE: null,
    OTP_HAS_EXPIRED: null,
    TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: null,
    ACCOUNT_TEMPORARILY_LOCKED: null,
    TOO_MANY_ATTEMPTS: null,
    EMAIL_CODE_SENT_RECENTLY: null,
    EMAIL_CODES_NOT_ALLOWED: null,
    MFA_REQUIRED_FOR_ROLE: null,
    SIGN_IN_CHANGE_IN_PROGRESS: null,
    MFA_VERIFICATION_REQUIRED: null,
    USER_VERIFICATION_REQUIRED: null,
    INVALID_TWO_FACTOR_COOKIE: null,
    ACCOUNT_DEACTIVATED: null,
    INVALID_PASSWORD: null,
    SESSION_NOT_FRESH: null,
    UNSAFE_RETURN_ADDRESS: null,
    RESET_ENDS_PROVIDER_MFA: null,
    REVERIFY_WRONG_ACCOUNT: null,
    TOTP_ALREADY_ENABLED: null,
    TWO_FACTOR_ALREADY_OFF: null,
    ERROR_CEREMONY_ABORTED: null,
    ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: null,
    INVALID_PASSKEY_NAME: { max: PASSKEY_NAME_MAX_LENGTH },
  };

/** The notice codes of `?notice=<code>` ({@link signInNoticeText}), by message key. */
const NOTICE_KEYS: Readonly<Record<string, NoticeKey>> = {
  'joined-mfa-required': 'joinedMfaRequired',
};

/**
 * Checks whether an error code has a message of its own.
 *
 * @param code - The code, e.g. from a URL or an error; anything else is fine.
 * @returns Whether it's one of the codes in `auth.codes.errors`.
 */
export function isAuthErrorCode(code: unknown): code is AuthErrorCode {
  return typeof code === 'string' && Object.hasOwn(ERROR_CODE_VALUES, code);
}

/**
 * The message of a code that has one, in the reader's language. The guards
 * use it for the refusals they throw, so other clients get the request's
 * language too.
 *
 * @param t - Translates the `auth` namespace.
 * @param code - The code.
 * @returns The message, e.g. "That code isn't right. Check it and try again."
 */
export function authCodeText(t: AuthTranslator, code: AuthErrorCode): string {
  return t(`codes.errors.${code}`, ERROR_CODE_VALUES[code] ?? undefined);
}

/**
 * The message for a code only when there's one for it (unlike
 * {@link signInErrorText}, which falls back to a general one).
 *
 * @param t - Translates the `auth` namespace.
 * @param code - The code, if any.
 * @returns The message, or `null` for no code or one without a message.
 */
export function knownAuthErrorText(
  t: AuthTranslator,
  code: string | null | undefined,
): string | null {
  return isAuthErrorCode(code) ? authCodeText(t, code) : null;
}

/**
 * The message for a code, e.g. the `error` query parameter Better Auth comes
 * back with to the sign-in page.
 *
 * @param t - Translates the `auth` namespace.
 * @param code - The code, if any.
 * @returns The message (a general one for unknown codes), or `null` without a code.
 */
export function signInErrorText(t: AuthTranslator, code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return knownAuthErrorText(t, code) ?? t('codes.fallback');
}

/**
 * The note the sign-in page shows for `?notice=<code>`, when another page
 * sent the user there on purpose (not an error): e.g. after joining with an
 * invite link for a role that requires MFA, which ended the session
 * (`withMfaPromotion`).
 *
 * @param t - Translates the `auth` namespace.
 * @param code - The `notice` query parameter, if any.
 * @returns The note, or `null` for none or an unknown code.
 */
export function signInNoticeText(
  t: AuthTranslator,
  code: string | null | undefined,
): string | null {
  const key = code ? ownValue(NOTICE_KEYS, code) : undefined;
  return key ? t(`codes.notices.${key}`) : null;
}

/**
 * The step-up page's message after "Confirm with GitHub" (a re-verify) came
 * back with `?error=<code>&provider=<id>`. A refused re-verify, and Better
 * Auth's codes that would reveal whether an address has an account
 * ({@link REVERIFY_REFUSALS}), all say the user signed in with a different
 * account, naming the provider when it's one that can prove MFA; other codes
 * get their usual message ({@link signInErrorText}).
 *
 * @param t - Translates the `auth` namespace.
 * @param code - The `error` query parameter, if any.
 * @param provider - The `provider` query parameter, if any (the browser can change it).
 * @returns The message, or `null` when there is no error.
 */
export function reverifyErrorText(
  t: AuthTranslator,
  code: string | null | undefined,
  provider: string | null | undefined,
): string | null {
  if (!code || !REVERIFY_REFUSALS.has(code)) {
    return signInErrorText(t, code);
  }
  return isMfaProvider(provider)
    ? t('codes.reverifyWrongAccount', { provider: PROVIDER_LABELS[provider] })
    : authCodeText(t, REVERIFY_WRONG_ACCOUNT.code);
}

/**
 * The message for a refused sign-in change (the MFA a role requires, another
 * change still running), for forms that otherwise show their own generic
 * failure.
 *
 * @param t - Translates the `auth` namespace.
 * @param code - The error's code, if any.
 * @returns The message, or `null` when the code isn't such a refusal.
 */
export function signInChangeRefusalText(
  t: AuthTranslator,
  code: string | null | undefined,
): string | null {
  return code && SIGN_IN_CHANGE_REFUSALS.has(code) ? signInErrorText(t, code) : null;
}

/** A failed request of the auth client (Better Auth or passkeys), as the forms get it. */
export interface AuthClientError {
  /** HTTP status, if known. */
  status?: number;
  /** Error code, if any. */
  code?: string;
  /** The server's message: only shown for codes the server words itself. */
  message?: string;
}

/**
 * Turns a failed request of the auth client into what the form says, in the
 * reader's language:
 * 1. A refusal the server words itself (`SERVER_WORDED_CODES`, e.g. a pause
 *    with how long it lasts) is shown as it comes.
 * 2. A code with a message of its own gets that message.
 * 3. Any other rate limit (e.g. Better Auth's per-IP limit) gets "Too many
 *    requests".
 * 4. Anything else gets the form's own fallback, or "Signing in failed".
 *
 * Better Auth's own `message` is never shown: it's English, and written for
 * developers.
 *
 * @param t - Translates the `auth` namespace.
 * @param error - The client's error.
 * @param fallback - What to say for an unknown failure, already translated
 *   (e.g. "Sending the link failed. Please try again."); by default the
 *   general sign-in failure.
 * @returns The message.
 */
export function authErrorText(
  t: AuthTranslator,
  error: AuthClientError,
  fallback?: string,
): string {
  if (isServerWorded(error.code) && error.message) {
    return error.message;
  }
  const known = knownAuthErrorText(t, error.code);
  if (known) {
    return known;
  }
  if (error.status === 429) {
    return t('codes.tooManyRequests');
  }
  return fallback ?? t('codes.fallback');
}
