/**
 * @file Checks run before Better Auth handles a request (`hooks.before` in
 * `src/lib/auth.ts`, loaded on use like `auth-events`). What they leave
 * for the reactions after the request (attempts taken, a lock held, a code
 * step's user) goes in the request's typed state (`request-state.ts`). They
 * close the gaps between Better Auth's endpoints and the app's MFA rules
 * (`src/lib/authz/mfa/`):
 *
 * - Changing sign-in methods (passkeys, connecting or disconnecting
 *   GitHub/Google, two-step verification, backup codes) needs a session
 *   confirmed with the second step in the last 15 minutes once the account
 *   has one (`mfaConfirmedUntil`; GitHub only counts there when the account
 *   has no passkey or authenticator app), so a one-factor session (an email
 *   link, Google, a password set through a reset link) can't add its own way
 *   in, and neither can a stolen session long after its sign-in. That includes
 *   finishing an authenticator setup while email codes are on. Accounts
 *   without a second step instead need a sign-in from the last hour for any
 *   such change (`needsFreshSignIn`; Better Auth's own `freshAge` is off,
 *   since a step-up doesn't renew it).
 * - A sign-in link (`/magic-link/verify`) only signs in with the "Continue
 *   signing in" on its own page (`src/lib/sign-in/email-link.ts`), a form
 *   `POST` that only that page makes (`isOwnPagePost`, decision 0041); every
 *   `GET` of it, whatever its headers, and any other `POST` go to that page
 *   first, unused. So a mail scanner can't use it up, and a crafted link,
 *   even one written in a request's text, can't sign someone in without the
 *   page that names the account.
 * - Return addresses (where Better Auth sends the browser afterwards, or
 *   what it puts into an emailed link) must be pages of the app
 *   (`isSafeAppRedirect`): never another site, and never an endpoint under
 *   `/api`. Otherwise a sign-in link could go on to a second
 *   `/magic-link/verify`, which the browser would open as part of the same
 *   click, signing the user in to whoever made that second link.
 * - Passkey names, where a passkey is added or renamed, follow the rules of
 *   names people choose (`passkeyNameSchema`: at most 64 characters, no line
 *   breaks or characters that hide or reorder text); Better Auth's own check
 *   only trims them (`INVALID_PASSKEY_NAME`).
 * - Two-step verification can only be turned on by proving a code: an
 *   authenticator app through `/two-factor/enable`, email codes through
 *   their code step.
 * - Backup codes only work once their authenticator app is set up, so an
 *   unfinished setup can't leave a way in.
 * - Two-step verification that's off already can't be turned off: Better
 *   Auth would still replace the session, and the reactions would record and
 *   email a change that didn't happen (`TWO_FACTOR_ALREADY_OFF`).
 * - A role that requires MFA can't lose it through a change (the last
 *   passkey, the only authenticator app, the only MFA provider, a first
 *   password or another provider next to provider MFA,
 *   `wouldRemoveRequiredMfa`), also from a page rendered before another
 *   change; the user adds another method first.
 * - A password reset link (or welcome link) can't give an account its first
 *   password when that would end its MFA (a provider account with
 *   two-factor authentication, which only counts without a password:
 *   `wouldEndMfa`), whatever the role. Otherwise whoever reads the inbox
 *   would get past the provider's second step with the new password alone.
 *   The user signs in with the provider and sets a password on the Security
 *   page instead (`RESET_ENDS_PROVIDER_MFA`).
 * - Email codes are refused where they don't count: once an authenticator
 *   app is set up, and to confirm sessions of roles that require MFA (staff
 *   Admins and Managers, company Admins).
 * - Wrong codes on the step-up page are limited per user; Better Auth only
 *   limits codes at sign-in. So are wrong current passwords where Better
 *   Auth checks one (turning two-step verification on or off, new backup
 *   codes: `CURRENT_PASSWORD_PATHS`), in the password forms' bucket
 *   (`checkCurrentPassword`), and the reactions record each wrong one. A
 *   code checked at a password sign-in's code step (without a session yet)
 *   hands its user, from Better Auth's two-factor cookie, to `auth-events`,
 *   which records a wrong one (`pendingCodeSignInOf`).
 * - "Confirm with GitHub" on the step-up page is marked as a re-verify of
 *   the browser's session (`markReverify` in `reverify-marker.ts`), so only
 *   the user's own confirmed account of the provider can answer it
 *   (`checkReverify` in `auth-events`).
 * - Wrong passwords are limited per email address, and email links, password
 *   resets and emailed codes per address or user, whether or not the address
 *   has an account, on top of Better Auth's per-IP limits (which a client can
 *   get around by changing its IP address). Since anyone can pause an
 *   address's password sign-in this way, the refusal points to the other ways
 *   in, the same for every address, and proving control of the inbox lifts
 *   it (`clearFailedSignIns` in `failed-sign-ins.ts`): a completed password reset
 *   or an accepted invitation.
 *
 * Wrong passwords, wrong current passwords and wrong step-up codes are
 * counted before the check, and given back by `auth-events` after the
 * request unless the password or code was wrong (`settlePasswordAttempt`,
 * `settleCurrentPasswordAttempt`, `settleStepUpAttempt`),
 * so requests sent at the same moment can't all get past the limit, and
 * successful ones (or ones Better Auth refused before checking) don't count.
 *
 * Refusals are `APIError`s with a `code` that the pages turn into messages in
 * the reader's language (`authErrorText` in `src/lib/sign-in/auth-error-messages.ts`);
 * the refusals the browser reacts to are declared once in
 * `src/lib/sign-in/sign-in-refusals.ts`. Each refusal's message is worded in
 * the request's language (`refusal-messages.ts`, from its language cookie):
 * forms show it as it comes only for the refusals with details the browser
 * can't know (`SERVER_WORDED_CODES`: how long to wait, which providers).
 *
 * This is the module's public API: the checks live in the files next to it,
 * and nothing outside this folder imports them directly.
 */
export { CODE_PATHS, CURRENT_PASSWORD_PATHS } from './paths';
export type { AuthGuardContext } from './paths';
export {
  endEmailCodeCooldown,
  countFailedSignIn,
  sessionCodeChallenge,
  settleCurrentPasswordAttempt,
  settlePasswordAttempt,
  settleStepUpAttempt,
} from './attempts';
export { holdSignInChangeLock, releaseSignInChangeLockOf } from './change-lock';
export { finishesAuthenticatorSetup } from './signed-in';
export { pendingCodeSignInOf } from './code-step';
export { beforeAuthRequest } from './before-request';
