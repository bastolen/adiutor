/**
 * @file How long emailed codes last, how soon a new one can be sent, and when
 * two-step verification locks after wrong codes. No imports, so the
 * browser can use these without pulling in the rules.
 */

/**
 * How long an emailed code works, in minutes: Better Auth's
 * `otpOptions.period` in `src/lib/auth.ts`, and what the code step, the
 * step-up page and the email tell the user.
 */
export const EMAIL_CODE_MINUTES = 5;

/**
 * How long a user waits before asking for another emailed code, in seconds:
 * half a code's lifetime, so the last one still works for a while. The auth
 * guards refuse a new code sooner (`EMAIL_CODE_SENT_RECENTLY`), and the
 * forms count it down on "Send a new code". Using a code ends the wait.
 */
export const EMAIL_CODE_RESEND_SECONDS = (EMAIL_CODE_MINUTES * 60) / 2;

/**
 * Wrong codes in a row at the code step of a sign-in (across sign-ins and
 * kinds of code) after which signing in with a code is paused for
 * {@link TWO_FACTOR_LOCK_MINUTES}: Better Auth's `accountLockout` in
 * `src/lib/auth.ts`. It only applies to accounts with an authenticator app,
 * or one being set up (Better Auth keeps the count on its `two_factor` row),
 * not to accounts with only email codes; a right code starts the count again.
 */
export const TWO_FACTOR_LOCK_ATTEMPTS = 10;

/**
 * How long signing in with a code stays paused after
 * {@link TWO_FACTOR_LOCK_ATTEMPTS} wrong codes, in minutes: Better Auth's
 * `accountLockout` in `src/lib/auth.ts`, what the lockout email says, and how
 * often that email is sent at most (once per pause).
 */
export const TWO_FACTOR_LOCK_MINUTES = 15;
