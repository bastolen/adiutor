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
 * provider) and which the guards word in the request's language. Only the
 * refusals that Better Auth itself is given to throw ({@link ACCOUNT_DEACTIVATED},
 * {@link REVERIFY_WRONG_ACCOUNT}) carry an English (US) `message`, for its error
 * description. See docs/authentication.md, "How refusals reach the user".
 */

/** A refusal: the error code, which forms turn into the message in the reader's language. */
export interface SignInRefusal {
  /** The error code, as Better Auth returns it in `error.code`. */
  readonly code: string;
}

/**
 * A refusal that Better Auth throws itself (`new APIError(..., { ...refusal })`), so it has
 * something to say in its error description: its English (US) text. Forms still translate the
 * code, never show this.
 */
export interface SignInRefusalWithMessage extends SignInRefusal {
  /** The error's description, in English (US). */
  readonly message: string;
}

/**
 * Too many sign-ins, emails or codes for this account or address. The
 * guards word their message, which says how long to wait
 * ({@link SERVER_WORDED_CODES}); the catalogue's text, without the wait, is
 * for when there's none.
 */
export const TOO_MANY_ATTEMPTS = {
  code: 'TOO_MANY_ATTEMPTS',
} as const satisfies SignInRefusal;

/**
 * A code was emailed to this user less than `EMAIL_CODE_RESEND_SECONDS` ago
 * (half a code's lifetime), so it still works: no new one yet. The forms show
 * this as a notice, not an error, and count down until a new one may be sent.
 */
export const EMAIL_CODE_SENT_RECENTLY = {
  code: 'EMAIL_CODE_SENT_RECENTLY',
} as const satisfies SignInRefusal;

/**
 * Email codes aren't accepted for this account: an authenticator app is set
 * up, or the role requires MFA (`allowsEmailCodes`).
 */
export const EMAIL_CODES_NOT_ALLOWED = {
  code: 'EMAIL_CODES_NOT_ALLOWED',
} as const satisfies SignInRefusal;

/** The change would take away the MFA the user's role requires (`wouldRemoveRequiredMfa`). */
export const MFA_REQUIRED_FOR_ROLE = {
  code: 'MFA_REQUIRED_FOR_ROLE',
} as const satisfies SignInRefusal;

/** Another change to how the user signs in is still being made (`withSignInChangeLock`). */
export const SIGN_IN_CHANGE_IN_PROGRESS = {
  code: 'SIGN_IN_CHANGE_IN_PROGRESS',
} as const satisfies SignInRefusal;

/**
 * The change needs a confirmation with the second step from the last 15
 * minutes (`needsRecentConfirmation`); the Security page sends the user to
 * the step-up page for it.
 */
export const MFA_VERIFICATION_REQUIRED = {
  code: 'MFA_VERIFICATION_REQUIRED',
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
 * ({@link SERVER_WORDED_CODES}).
 */
export const RESET_ENDS_PROVIDER_MFA = {
  code: 'RESET_ENDS_PROVIDER_MFA',
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
} as const satisfies SignInRefusal;

/**
 * The account is deactivated, so it can't sign in or get a provider account
 * connected (`checkIncomingUser`, and the backstop in `beforeSessionCreate`,
 * in `src/server/auth/auth-events/`) until an Admin reactivates it.
 */
export const ACCOUNT_DEACTIVATED = {
  code: 'ACCOUNT_DEACTIVATED',
  message: 'This account is deactivated. Contact an administrator.',
} as const satisfies SignInRefusalWithMessage;

/**
 * A passkey name the guards refuse when a passkey is added or renamed
 * (`passkeyNameSchema`): empty, longer than `PASSKEY_NAME_MAX_LENGTH`
 * characters, or with line breaks, control characters or characters that
 * hide or reorder text.
 */
export const INVALID_PASSKEY_NAME = {
  code: 'INVALID_PASSKEY_NAME',
} as const satisfies SignInRefusal;

/** An account without a second step must have signed in within the last hour to add one. */
export const SESSION_NOT_FRESH = {
  code: 'SESSION_NOT_FRESH',
} as const satisfies SignInRefusal;

/**
 * "Confirm with GitHub" on the step-up page (a re-verify) signed in with
 * another provider account than the user's own confirmed one: a new account
 * with their email address, another user's account, or one of their own
 * that isn't confirmed as a second step (`mayReverifyWith`). It's refused
 * before anything is connected or any session is created
 * (`checkReverify` in `src/server/auth/auth-events/reverify.ts`). The message
 * doesn't name the provider; the step-up page names it (`reverifyErrorText`).
 */
export const REVERIFY_WRONG_ACCOUNT = {
  code: 'REVERIFY_WRONG_ACCOUNT',
  message:
    "The sign-in provider couldn't confirm it's you: you signed in with a different account than the one you set up as a second step. Nothing was changed. Sign in with that account and try again, or use another second step.",
} as const satisfies SignInRefusalWithMessage;

/**
 * The session is a staff member's, signed in as a user ("Sign in as"): Better
 * Auth's endpoints would act on the staff member's own account, so every one
 * but reading the session and signing out is refused (`refuseWhileSignedInAs`
 * in `src/server/auth/auth-guards/`).
 */
export const SIGNED_IN_AS_SOMEONE = {
  code: 'SIGNED_IN_AS_SOMEONE',
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
