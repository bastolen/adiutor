/**
 * @file Reacts to Better Auth activity (`hooks.after` and the database hooks in
 * `src/lib/auth.ts`): records it in the audit log, sets each session's MFA
 * level and method, keeps a replaced session's sign-in time and end,
 * refuses deactivated accounts and a "Confirm with GitHub" that isn't the
 * user's own confirmed account, forgets trusted devices, counts wrong
 * passwords and codes (telling the owner when they pause signing in), keeps
 * the MFA status of provider accounts up to date, tells the next page what
 * happened (a provider account connected, a step-up that didn't confirm), and
 * tracks when users were last active. The reactions run in named phases
 * (see `afterAuthRequest`); each file's own comment says what it reacts to.
 *
 * What one hook of a request passes on to the next (with the guards in
 * `auth-guards`) is kept in the request's typed state (`request-state.ts`).
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
  noteProviderProfile,
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
