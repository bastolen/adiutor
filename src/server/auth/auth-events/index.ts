/**
 * @file Reacts to Better Auth activity: records it in the audit log, sets
 * each session's MFA level and method, keeps the sign-in time and end of a
 * session Better Auth replaces for the same sign-in (so a replacement never
 * renews it), refuses deactivated accounts, refuses "Confirm with GitHub" on
 * the step-up page with any other account than the user's own confirmed
 * one, forgets trusted devices ("Trust this device" at the code step) when
 * two-step verification is turned off, the password is changed or reset, an
 * authenticator app is set up next to email codes, or the browser signs out
 * (that browser's own), counts wrong passwords (telling the owner when they
 * pause password sign-in), records wrong codes at a password sign-in's code
 * step (telling the owner when they pause signing in with a code), keeps the
 * MFA status of provider accounts up to
 * date (for providers that can prove MFA), tells the next page when a
 * provider account was connected at sign-in or didn't confirm a session on
 * the step-up page, ends the session a browser had when someone signs in
 * there (as signing out would, also another user's), and tracks when users
 * were last active.
 *
 * What one hook of a request passes on to the next (with the guards in
 * `auth-guards`) is kept in the request's typed state (`request-state.ts`).
 * The reactions after a request run in named phases (see `afterAuthRequest`).
 *
 * `src/lib/auth.ts` loads this module inside its hooks, so code that only
 * loads the auth config (like `pnpm auth:schema`) doesn't load it.
 * Problems in the reactions are logged, never shown to the user, except the
 * deactivated-account and re-verify refusals, which are the point.
 *
 * This is the module's public API: the hooks live in the files next to it,
 * and nothing outside this folder imports them directly.
 */
export type { AuthHookContext } from './hook-context';
export {
  withoutKeptTokens,
  noteProviderAccountName,
  beforeAccountUpdate,
  beforeAccountCreate,
  afterAccountCreate,
  afterAccountDelete,
} from './provider-accounts';
export { checkIncomingUser } from './reverify';
export type { IncomingUserInfo } from './reverify';
export { beforeSessionCreate, afterSessionCreate } from './session-hooks';
export { afterPasswordSignIn } from './password-sign-in';
export { onPasswordReset, beforeUserUpdate, afterUserUpdate, onEmailVerified } from './user-hooks';
export { afterAuthRequest } from './after-request';
