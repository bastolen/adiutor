/**
 * @file User-facing messages for sign-in error codes, shared by the sign-in
 * pages, the step-up page, the sign-in error page and the account pages.
 * Pure and client-safe.
 *
 * Better Auth redirects back to the sign-in page with `?error=<code>` when an
 * OAuth or magic link sign-in fails, and returns codes from passkey and
 * second-step requests. The refusals of the auth guards come from
 * `./sign-in-refusals`, so their codes and messages are declared once.
 */
import ownValue from '@/lib/own-value';

import { isMfaProvider, PROVIDER_LABELS } from './oauth-providers';
import {
  ACCOUNT_DEACTIVATED,
  EMAIL_CODES_NOT_ALLOWED,
  EMAIL_CODE_SENT_RECENTLY,
  INVALID_PASSKEY_NAME,
  MFA_REQUIRED_FOR_ROLE,
  MFA_VERIFICATION_REQUIRED,
  RESET_ENDS_PROVIDER_MFA,
  REVERIFY_WRONG_ACCOUNT,
  reverifyWrongAccountMessage,
  SESSION_NOT_FRESH,
  SIGN_IN_CHANGE_IN_PROGRESS,
  TOO_MANY_ATTEMPTS,
  TWO_FACTOR_ALREADY_OFF,
  UNSAFE_RETURN_ADDRESS,
} from './sign-in-refusals';

/** Shown for any code without a specific message. */
const FALLBACK_MESSAGE = 'Signing in failed. Please try again.';

/**
 * Messages per error code. Codes come from Better Auth's OAuth callback and
 * magic link verification.
 */
const messages: Record<string, string> = {
  /** OAuth sign-in for an email without an account. */
  signup_disabled:
    "There's no Adiutor account for that email address. Ask an administrator to create one.",
  /** Magic link for an email without an account. */
  new_user_signup_disabled:
    "There's no Adiutor account for that email address. Ask an administrator to create one.",
  /** OAuth provider couldn't be linked, e.g. because it didn't verify the email. */
  account_not_linked:
    "This sign-in method couldn't be linked to your account. Sign in another way, or use an address your provider has verified.",
  /** Magic link or reset link was already used, or never existed. */
  INVALID_TOKEN: 'This link is invalid or has already been used. Request a new one.',
  /** Magic link or reset link is too old. */
  expired_token: 'This link has expired. Request a new one.',
  /** The passkey prompt was dismissed or timed out. */
  AUTH_CANCELLED: 'Signing in with a passkey was cancelled. Try again, or sign in another way.',
  /** The browser offered a passkey that isn't linked to an account here. */
  PASSKEY_NOT_FOUND: "That passkey isn't linked to an Adiutor account. Sign in another way.",
  /** Wrong code from an authenticator app or email. */
  INVALID_CODE: "That code isn't right. Check it and try again.",
  /** Wrong or already used backup code. */
  INVALID_BACKUP_CODE: "That backup code isn't right, or it was already used.",
  /** Emailed code is too old. */
  OTP_HAS_EXPIRED: 'That code has expired. Send a new one.',
  /** Too many wrong guesses for one emailed code. */
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Too many wrong attempts. Send a new code and try again.',
  /** Too many wrong codes in a row for the account. */
  ACCOUNT_TEMPORARILY_LOCKED:
    'Too many wrong codes. For your safety, signing in is paused for 15 minutes.',
  /** Too many sign-ins, emails or codes for this account or address (`auth-guards/`). */
  [TOO_MANY_ATTEMPTS.code]: TOO_MANY_ATTEMPTS.message,
  /** A code was emailed a moment ago and still works (`EMAIL_CODE_RESEND_SECONDS`). */
  [EMAIL_CODE_SENT_RECENTLY.code]: EMAIL_CODE_SENT_RECENTLY.message,
  /** Email codes aren't accepted for this account (authenticator app set up, or a role that requires MFA). */
  [EMAIL_CODES_NOT_ALLOWED.code]: EMAIL_CODES_NOT_ALLOWED.message,
  /** The change would take away the MFA the user's role requires (`wouldRemoveRequiredMfa`). */
  [MFA_REQUIRED_FOR_ROLE.code]: MFA_REQUIRED_FOR_ROLE.message,
  /** Another change to how the user signs in is still being made (`sign-in-change-lock.ts`). */
  [SIGN_IN_CHANGE_IN_PROGRESS.code]: SIGN_IN_CHANGE_IN_PROGRESS.message,
  /** Changing sign-in methods needs a confirmation with the second step from the last 15 minutes. */
  [MFA_VERIFICATION_REQUIRED.code]: MFA_VERIFICATION_REQUIRED.message,
  /** A passkey was used without a fingerprint, face or device PIN. */
  USER_VERIFICATION_REQUIRED:
    'Use your fingerprint, face or device PIN with this passkey, then try again.',
  /** The pending sign-in (10 minutes) expired or was already used. */
  INVALID_TWO_FACTOR_COOKIE: 'Your sign-in has expired. Start again.',
  /** A deactivated account tried to sign in, or to get a provider account connected. */
  [ACCOUNT_DEACTIVATED.code]: ACCOUNT_DEACTIVATED.message,
  /** Wrong password when confirming a security change. */
  INVALID_PASSWORD: 'That password is incorrect.',
  /** A security change needs a recent sign-in. */
  [SESSION_NOT_FRESH.code]: SESSION_NOT_FRESH.message,
  /** A return address that isn't a page of the app, e.g. under `/api` (`isSafeAppRedirect`). */
  [UNSAFE_RETURN_ADDRESS.code]: UNSAFE_RETURN_ADDRESS.message,
  /**
   * A reset link would give an account with only provider MFA a password, which ends it; without
   * naming the provider (the guards' own message, which the reset page shows, names it:
   * `resetEndsProviderMfaMessage`).
   */
  [RESET_ENDS_PROVIDER_MFA.code]: RESET_ENDS_PROVIDER_MFA.message,
  /**
   * "Confirm with GitHub" signed in with another account than the user's own confirmed one;
   * without naming the provider (the step-up page names it: {@link reverifyErrorMessage}).
   */
  [REVERIFY_WRONG_ACCOUNT.code]: REVERIFY_WRONG_ACCOUNT.message,
  /** An authenticator app is set up already. */
  TOTP_ALREADY_ENABLED: 'An authenticator app is already set up.',
  /** Turning off two-step verification that's off already (`auth-guards/`). */
  [TWO_FACTOR_ALREADY_OFF.code]: TWO_FACTOR_ALREADY_OFF.message,
  /** The browser's passkey prompt was dismissed. */
  ERROR_CEREMONY_ABORTED: 'Adding the passkey was cancelled. Try again when you are ready.',
  /** That passkey (device) is already added to this account. */
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: 'This passkey is already added to your account.',
  /** A passkey name that's empty, too long or has invisible characters (`auth-guards/`). */
  [INVALID_PASSKEY_NAME.code]: INVALID_PASSKEY_NAME.message,
};

/**
 * Notes the sign-in page shows for `?notice=<code>`, when another page sent
 * the user there on purpose (not errors).
 */
const NOTICES: Record<string, string> = {
  /** Joined with an invite link for a role that requires MFA, which ended the session (`withMfaPromotion`). */
  'joined-mfa-required':
    'You’ve joined. Your new role requires MFA, so sign in again and then set up a passkey or an authenticator app.',
};

/**
 * Returns the note for a sign-in notice code.
 *
 * @param code - The `notice` query parameter, if any.
 * @returns The note, or `null` for none or an unknown code.
 */
export function getSignInNotice(code: string | null | undefined): string | null {
  return (code && ownValue(NOTICES, code)) || null;
}

/** Codes that are rate limits with their own message (other 429s get a generic one). */
const LIMIT_CODES = new Set<string>([
  'ACCOUNT_TEMPORARILY_LOCKED',
  TOO_MANY_ATTEMPTS.code,
  EMAIL_CODE_SENT_RECENTLY.code,
]);

/** Shown for rate limits without their own message, e.g. Better Auth's per-IP limit. */
const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Wait a few seconds and try again.';

/**
 * Returns the message for a sign-in error code only when there's one for
 * that code (unlike {@link getAuthErrorMessage}, which falls back to a
 * general one).
 *
 * @param code - The error code.
 * @returns The message, or `null` for codes without one.
 */
export function knownAuthErrorMessage(code: string): string | null {
  return ownValue(messages, code) ?? null;
}

/**
 * Returns a user-facing message for a sign-in error code.
 *
 * @param code - The `error` query parameter, if any.
 * @returns The message, or `null` when there is no error.
 */
export default function getAuthErrorMessage(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return ownValue(messages, code) ?? FALLBACK_MESSAGE;
}

/**
 * Codes the step-up page shows as {@link REVERIFY_WRONG_ACCOUNT} after
 * "Confirm with GitHub": the refusal itself, and Better Auth's own answers
 * for an account it couldn't sign in with (no Adiutor account with that
 * address, or one it wouldn't connect), which would otherwise tell whether an
 * address has an Adiutor account. Either way, it wasn't the user's own
 * confirmed account.
 */
const REVERIFY_REFUSALS = new Set<string>([
  REVERIFY_WRONG_ACCOUNT.code,
  'signup_disabled',
  'account_not_linked',
]);

/**
 * Returns the message for an error code on the step-up page, where "Confirm
 * with GitHub" (a re-verify) comes back with `?error=<code>&provider=<id>`.
 * A refused re-verify, and Better Auth's codes that would reveal whether an
 * address has an account ({@link REVERIFY_REFUSALS}), all say the user signed
 * in with a different account, naming the provider when it's one that can
 * prove MFA; other codes get their usual message ({@link getAuthErrorMessage}).
 *
 * @param code - The `error` query parameter, if any.
 * @param provider - The `provider` query parameter, if any (the browser can change it).
 * @returns The message, or `null` when there is no error.
 */
export function reverifyErrorMessage(
  code: string | null | undefined,
  provider: string | null | undefined,
): string | null {
  if (!code || !REVERIFY_REFUSALS.has(code)) {
    return getAuthErrorMessage(code);
  }
  return reverifyWrongAccountMessage(isMfaProvider(provider) ? PROVIDER_LABELS[provider] : null);
}

/** Refusals of a sign-in change that say what to do (the rule for the role, another change still running). */
const SIGN_IN_CHANGE_REFUSALS = new Set<string>([
  MFA_REQUIRED_FOR_ROLE.code,
  SIGN_IN_CHANGE_IN_PROGRESS.code,
]);

/**
 * Returns the message for a refused sign-in change, for forms that otherwise
 * show their own generic failure.
 *
 * @param code - The error's code, if any.
 * @returns The message, or `null` when the code isn't such a refusal.
 */
export function signInChangeRefusalMessage(code: string | null | undefined): string | null {
  return code && SIGN_IN_CHANGE_REFUSALS.has(code) ? getAuthErrorMessage(code) : null;
}

/**
 * Returns the message for a failed request of the auth client (Better Auth or
 * passkeys), from the error's `code`.
 *
 * @param error - The client's error.
 * @returns The message; the general one without a known code.
 */
export function authErrorMessage(error: object): string {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return getAuthErrorMessage(code) ?? FALLBACK_MESSAGE;
}

/**
 * Returns the message for a failed request of the code step (sending or
 * checking a code), where rate limits are common: limits without their own
 * message get a general "too many requests".
 *
 * @param error - The client's error.
 * @param error.status - HTTP status.
 * @param error.code - Error code, if any.
 * @returns The message.
 */
export function codeStepErrorMessage(error: { status: number; code?: string }): string {
  return error.status === 429 && !LIMIT_CODES.has(error.code ?? '')
    ? TOO_MANY_REQUESTS_MESSAGE
    : authErrorMessage(error);
}
