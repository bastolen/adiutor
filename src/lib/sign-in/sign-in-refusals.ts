/**
 * @file Refusals of a sign-in or of a change to how someone signs in that
 * the browser reacts to: the error code the auth guards
 * (`src/server/auth/auth-guards/`), the auth reactions
 * (`src/server/auth/auth-events/`) and the sign-in services return for each.
 * Pure and client-safe, so the server that refuses and the pages and forms
 * that react to a code (`src/lib/sign-in/auth-error-messages.ts`, the
 * Security page) share one source, and renaming a code can't break one side
 * silently.
 *
 * The codes are what counts: forms turn a code into its message in the
 * reader's language (`auth.codes.errors` in the catalogues, through
 * `authErrorText`), except the refusals in {@link SERVER_WORDED_CODES},
 * whose message has details only the server knows (how long to wait, which
 * provider) and which the guards word in the request's language. Each
 * refusal's `message` is its English (US) text, for code that hasn't moved
 * to the catalogues yet. See docs/authentication.md, "How refusals reach the
 * user".
 */
import { PASSKEY_NAME_MAX_LENGTH } from '../input-rules';

/** A refusal: the error code and the message that goes with it. */
export interface SignInRefusal {
  /** The error code, as Better Auth returns it in `error.code`. */
  readonly code: string;
  /** What the user is told, in English (US); forms translate the code instead. */
  readonly message: string;
}

/**
 * Too many sign-ins, emails or codes for this account or address. The
 * guards word their own message, which says how long to wait
 * ({@link SERVER_WORDED_CODES}); this one, without the wait, is for when
 * there's none.
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
 * A password reset link (or welcome link) would give an account its first
 * password while its MFA is a provider account with two-factor
 * authentication, which only counts while there's no password
 * (`wouldEndMfa`): the reset would end it, and whoever reads the inbox would
 * get in with the password alone. Refused for every role by the guards before
 * Better Auth sets it. The user signs in with the provider instead and sets a
 * password on the Security page, where it needs a recent confirmation; roles
 * that require MFA add a passkey or an authenticator app there first. The
 * guards' message names the providers and the reset page shows it as it is
 * ({@link SERVER_WORDED_CODES}); this one doesn't.
 */
export const RESET_ENDS_PROVIDER_MFA = {
  code: 'RESET_ENDS_PROVIDER_MFA',
  message:
    "This account signs in with a provider account as its second step, so a password can't be set from a reset link. Nothing was changed. Sign in with that account, then set a password on the Security page.",
} as const satisfies SignInRefusal;

/**
 * Password sign-in for an address is paused after too many wrong passwords
 * (`reservePasswordAttempt` in the guards). Only the guards word it, with how
 * long the pause lasts ({@link SERVER_WORDED_CODES}): the same for every
 * address, whether or not it has an account.
 */
export const PASSWORD_SIGN_IN_PAUSED = {
  code: 'PASSWORD_SIGN_IN_PAUSED',
} as const satisfies Pick<SignInRefusal, 'code'>;

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
 * Says in English (US) that a provider couldn't confirm the session on the
 * step-up page, because the user signed in there with another account than
 * their own confirmed one ({@link REVERIFY_WRONG_ACCOUNT}). The step-up page
 * says it in the reader's language (`reverifyErrorText`); the end-to-end
 * tests compare with this.
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
 * doesn't name the provider; the step-up page names it (`reverifyErrorText`).
 */
export const REVERIFY_WRONG_ACCOUNT = {
  code: 'REVERIFY_WRONG_ACCOUNT',
  message: reverifyWrongAccountMessage(null),
} as const satisfies SignInRefusal;

/**
 * Refusals whose message has details only the server knows: how long to wait
 * ({@link TOO_MANY_ATTEMPTS}, {@link PASSWORD_SIGN_IN_PAUSED}) and which
 * providers to sign in with ({@link RESET_ENDS_PROVIDER_MFA}). The guards
 * word them in the request's language, and forms show their `message` as it
 * comes (`authErrorText`). Every other code is turned into its message in the
 * browser, so Better Auth's English never reaches the user.
 */
export const SERVER_WORDED_CODES = [
  TOO_MANY_ATTEMPTS.code,
  PASSWORD_SIGN_IN_PAUSED.code,
  RESET_ENDS_PROVIDER_MFA.code,
] as const;

/**
 * Checks whether a refusal's message is worded by the server
 * ({@link SERVER_WORDED_CODES}).
 *
 * @param code - The error's code, if any.
 * @returns Whether the form shows the error's own message.
 */
export function isServerWorded(code: string | null | undefined): boolean {
  return SERVER_WORDED_CODES.some((worded) => worded === code);
}
