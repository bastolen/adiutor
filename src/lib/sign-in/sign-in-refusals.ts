/**
 * @file Refusals of a sign-in or of a change to how someone signs in that
 * the browser reacts to: the error code the auth guards
 * (`src/server/auth/auth-guards/`), the auth reactions
 * (`src/server/auth/auth-events/`) and the sign-in services return for each,
 * with the message the browser shows. Pure and client-safe, so the server
 * that refuses and the pages and forms that react to a code
 * (`src/lib/sign-in/auth-error-messages.ts`, the Security page) share one source,
 * and renaming a code can't break one side silently. Refusals whose message
 * the server words itself and the browser shows as it is (e.g. a paused
 * password sign-in) stay in the guards.
 */
import { type OAuthProvider, providerNames } from './oauth-providers';
import { PASSKEY_NAME_MAX_LENGTH } from '../input-rules';

/** A refusal: the error code and the message that goes with it. */
export interface SignInRefusal {
  /** The error code, as Better Auth returns it in `error.code`. */
  readonly code: string;
  /** What the user is told. */
  readonly message: string;
}

/**
 * Too many sign-ins, emails or codes for this account or address. The
 * guards' own message also says how long to wait; the browser shows this one.
 */
export const TOO_MANY_ATTEMPTS = {
  code: 'TOO_MANY_ATTEMPTS',
  message: 'Too many attempts. For your safety, wait 15 minutes and try again.',
} as const satisfies SignInRefusal;

/**
 * A code was emailed to this user less than `EMAIL_CODE_RESEND_SECONDS` ago
 * (half a code's lifetime), so it still works: no new one yet. The forms show
 * this as a notice, not an error, and count down until a new one may be sent.
 */
export const EMAIL_CODE_SENT_RECENTLY = {
  code: 'EMAIL_CODE_SENT_RECENTLY',
  message: 'We sent you a code a moment ago. Use that one, or ask for a new one in a few minutes.',
} as const satisfies SignInRefusal;

/**
 * Email codes aren't accepted for this account: an authenticator app is set
 * up, or the role requires MFA (`allowsEmailCodes`).
 */
export const EMAIL_CODES_NOT_ALLOWED = {
  code: 'EMAIL_CODES_NOT_ALLOWED',
  message: "Email codes can't be used for this account. Use your authenticator app or a passkey.",
} as const satisfies SignInRefusal;

/** The change would take away the MFA the user's role requires (`wouldRemoveRequiredMfa`). */
export const MFA_REQUIRED_FOR_ROLE = {
  code: 'MFA_REQUIRED_FOR_ROLE',
  message:
    'Your role requires MFA, and this would leave you without it. Add a passkey first, then try again.',
} as const satisfies SignInRefusal;

/** Another change to how the user signs in is still being made (`withSignInChangeLock`). */
export const SIGN_IN_CHANGE_IN_PROGRESS = {
  code: 'SIGN_IN_CHANGE_IN_PROGRESS',
  message: 'Another change to how you sign in is still in progress. Try again in a moment.',
} as const satisfies SignInRefusal;

/**
 * The change needs a confirmation with the second step from the last 15
 * minutes (`needsRecentConfirmation`); the Security page sends the user to
 * the step-up page for it.
 */
export const MFA_VERIFICATION_REQUIRED = {
  code: 'MFA_VERIFICATION_REQUIRED',
  message: 'Confirm it’s you with your second step before changing how you sign in.',
} as const satisfies SignInRefusal;

/**
 * A return address of a sign-in request (where Better Auth sends the browser
 * afterwards, or what it puts into an emailed link) isn't a page of the app:
 * another site, or an endpoint under `/api` such as a second sign-in link
 * (`isSafeAppRedirect`). The app's own pages never send one, so only a
 * crafted request or link gets this.
 */
export const UNSAFE_RETURN_ADDRESS = {
  code: 'UNSAFE_RETURN_ADDRESS',
  message:
    "This link can't be used: it would send you somewhere outside Adiutor's pages. Nothing was changed. Start again from the sign-in page.",
} as const satisfies SignInRefusal;

/**
 * Says why a password reset link can't set an account's first password: the
 * account's MFA is a provider account with two-factor authentication, which
 * only counts while there's no password (`wouldEndMfa`), so the reset would
 * end it, and whoever reads the inbox would get in with the password alone.
 * The user signs in with the provider instead and sets a password on the
 * Security page, where it needs a recent confirmation. Roles that require MFA
 * can't set one there next to provider MFA alone (`setFirstPassword`), so
 * they're told to add a passkey or an authenticator app first.
 *
 * @param providers - The providers whose accounts give the account its MFA
 *   (`mfaGivingProviders`); with none, the wording doesn't name one.
 * @param mfaRequired - Whether the user's role requires MFA (`requiresMfa`).
 * @returns The message, e.g. "This account signs in with GitHub as its second step, …".
 */
export function resetEndsProviderMfaMessage(
  providers: readonly OAuthProvider[],
  mfaRequired: boolean,
): string {
  const names = providerNames(providers);
  const step = names || 'a provider account';
  const signIn = names ? `Sign in with ${names}` : 'Sign in with that account';
  const next = mfaRequired
    ? `${signIn}, add a passkey or an authenticator app on the Security page, then set a password there.`
    : `${signIn}, then set a password on the Security page.`;
  return `This account signs in with ${step} as its second step, so a password can't be set from a reset link. Nothing was changed. ${next}`;
}

/**
 * A password reset link (or welcome link) would give an account its first
 * password while its MFA is a provider account with two-factor
 * authentication, which a password ends (`wouldEndMfa`); refused for every
 * role by the guards before Better Auth sets it. The guards' message names the
 * provider ({@link resetEndsProviderMfaMessage}) and the reset page shows it
 * as it is; this one doesn't.
 */
export const RESET_ENDS_PROVIDER_MFA = {
  code: 'RESET_ENDS_PROVIDER_MFA',
  message: resetEndsProviderMfaMessage([], false),
} as const satisfies SignInRefusal;

/**
 * Two-step verification is off already, so there's nothing to turn off. The
 * guards refuse `/two-factor/disable` then: Better Auth would still replace
 * the session, and the reactions would record and email a change that didn't
 * happen.
 */
export const TWO_FACTOR_ALREADY_OFF = {
  code: 'TWO_FACTOR_ALREADY_OFF',
  message: 'Two-step verification is already off. Nothing was changed.',
} as const satisfies SignInRefusal;

/**
 * The account is deactivated, so it can't sign in or get a provider account
 * connected (`checkIncomingUser`, and the backstop in `beforeSessionCreate`,
 * in `src/server/auth/auth-events/`) until an Admin reactivates it.
 */
export const ACCOUNT_DEACTIVATED = {
  code: 'ACCOUNT_DEACTIVATED',
  message: 'This account is deactivated. Contact an administrator.',
} as const satisfies SignInRefusal;

/**
 * A passkey name the guards refuse when a passkey is added or renamed
 * (`passkeyNameSchema`): empty, longer than {@link PASSKEY_NAME_MAX_LENGTH}
 * characters, or with line breaks, control characters or characters that
 * hide or reorder text.
 */
export const INVALID_PASSKEY_NAME = {
  code: 'INVALID_PASSKEY_NAME',
  message: `Use a passkey name of 1 to ${PASSKEY_NAME_MAX_LENGTH} characters, without line breaks or invisible characters.`,
} as const satisfies SignInRefusal;

/** An account without a second step must have signed in within the last hour to add one. */
export const SESSION_NOT_FRESH = {
  code: 'SESSION_NOT_FRESH',
  message: 'For your security, sign out and in again before changing this.',
} as const satisfies SignInRefusal;

/**
 * Says that a provider couldn't confirm the session on the step-up page,
 * because the user signed in there with another account than their own
 * confirmed one ({@link REVERIFY_WRONG_ACCOUNT}).
 *
 * @param provider - The provider's display name (`PROVIDER_LABELS`), or
 *   `null` when it isn't known: the wording then doesn't name one.
 * @returns The message, e.g. "GitHub couldn't confirm it's you: …".
 */
export function reverifyWrongAccountMessage(provider: string | null): string {
  if (!provider) {
    return "The sign-in provider couldn't confirm it's you: you signed in with a different account than the one you set up as a second step. Nothing was changed. Sign in with that account and try again, or use another second step.";
  }
  return `${provider} couldn't confirm it's you: you signed in with a different ${provider} account than the one you set up as a second step. Nothing was changed. Sign in to ${provider} with that account and try again, or use another second step.`;
}

/**
 * "Confirm with GitHub" on the step-up page (a re-verify) signed in with
 * another provider account than the user's own confirmed one: a new account
 * with their email address, another user's account, or one of their own
 * that isn't confirmed as a second step (`mayReverifyWith`). It's refused
 * before anything is connected or any session is created
 * (`checkReverify` in `src/server/auth/auth-events/reverify.ts`). The message here
 * doesn't name the provider; the step-up page names it
 * ({@link reverifyWrongAccountMessage}, through `reverifyErrorMessage`).
 */
export const REVERIFY_WRONG_ACCOUNT = {
  code: 'REVERIFY_WRONG_ACCOUNT',
  message: reverifyWrongAccountMessage(null),
} as const satisfies SignInRefusal;
