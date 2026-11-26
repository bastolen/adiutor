/**
 * @file Checks run before Better Auth handles a request (`hooks.before` in
 * `src/lib/auth.ts`, loaded on use like `auth-events`). They close the gaps
 * between Better Auth's endpoints and the app's MFA rules (`src/lib/authz/mfa/`,
 * `docs/mfa.md`, `docs/security-measures.md`); what they leave for the reactions after the request (attempts
 * taken, a lock held, a code step's user) goes in the request's typed state
 * (`request-state.ts`). Each check explains its rules where it lives:
 *
 * - `before-request.ts` routes a request to the checks for its endpoint.
 * - `request-checks.ts`: the request's own data (a sign-in link only signs in
 *   from its page's Continue, return addresses are pages of the app, passkey
 *   names follow the rules of names people choose).
 * - `signed-in.ts`: signed-in requests (the confirmation a change to sign-in
 *   methods needs, the MFA a role requires, turning two-step verification on
 *   or off, which email codes count, the limits on wrong codes and current
 *   passwords).
 * - `signed-in-as.ts`: nothing changes while a staff member is signed in as a user.
 * - `code-step.ts`: a password sign-in's code step, before there's a session.
 * - `password-reset.ts`: a first password can't end an account's provider MFA.
 * - `change-lock.ts`: one change to how a user signs in at a time.
 * - `attempts.ts`: limits on wrong passwords, wrong codes and emailed links,
 *   resets and codes. They're counted before the check and given back by
 *   `auth-events` after the request unless the password or code was wrong
 *   (`settlePasswordAttempt`, `settleCurrentPasswordAttempt`,
 *   `settleStepUpAttempt`), so requests sent at the same moment can't all get
 *   past the limit.
 *
 * Refusals are `APIError`s with a `code` that the pages turn into messages in
 * the reader's language (`authErrorText` in `src/lib/sign-in/auth-error-messages.ts`);
 * the refusals the browser reacts to are declared once in
 * `src/lib/sign-in/sign-in-refusals.ts`, and each message is worded in the
 * request's language (`refusal-messages.ts`).
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
export { beforeAuthRequest } from './before-request';
export { SIGN_IN_APP_NAME_PATHS, signInAppNameFor } from './sign-in-app-name';
