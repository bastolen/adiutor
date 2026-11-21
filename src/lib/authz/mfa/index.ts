/**
 * @file Multi-factor authentication rules: who must use it, what counts for
 * an account, which second steps a user may use, and which sign-ins count as
 * having had a second factor. This is the module's public API; the rules
 * live in the files next to it, and nothing outside this folder imports them
 * directly.
 *
 * Email codes are the weakest second step: they go to the same inbox that
 * email links and password resets go to. So they never count for the roles
 * that require MFA (staff Admins and Managers, and company Admins), and
 * they're never accepted once an authenticator app is set up (otherwise the
 * inbox alone would get past the app).
 *
 * The rules take the user's `MfaRole`, worked out by `mfaRoleOf`.
 * Provider MFA (an OAuth account whose provider says it has two-factor
 * authentication) only comes from the providers in `MFA_PROVIDERS`
 * (`src/lib/sign-in/oauth-providers.ts`), and only while they're configured here
 * (`ProviderAvailability`): no rule names a provider itself. It only
 * says the provider account has two-factor authentication, not that a
 * sign-in used it, so it confirms sessions but opens the window for changing
 * sign-in methods only on accounts without a passkey or authenticator app
 * (`mfaConfirmedUntil`).
 *
 * Starting to sign in as someone else asks for strong MFA whatever the staff
 * member's own role (`hasStrongMfa`, `strongMfaConfirmedUntil`): the rules of
 * the roles that require MFA, also for Support.
 */
export { requiresMfa, mfaRoleOf } from './requirement';
export type { MfaRole } from './requirement';
export { givesMfa, hasMfa, mfaGivingProviders, unavailableProviderMfa, mfaStatus } from './state';
export type { MfaState, ProviderAvailability, MfaStatus } from './state';
export {
  EMAIL_CODE_MINUTES,
  EMAIL_CODE_RESEND_SECONDS,
  TWO_FACTOR_LOCK_ATTEMPTS,
  TWO_FACTOR_LOCK_MINUTES,
} from './lifetimes';
export { allowsEmailCodes, allowsEmailCodesAtSignIn, emailCodeStatus } from './email-codes';
export type { EmailCodeStatus } from './email-codes';
export {
  wouldEndMfa,
  wouldRemoveRequiredMfa,
  confirmProviderChange,
  mfaDowngradeBlocks,
} from './sign-in-changes';
export type {
  SignInChange,
  UnconfirmedProviderAccount,
  MfaDowngradeBlocks,
} from './sign-in-changes';
export {
  NO_STEP_UP_METHODS,
  stepUpMethods,
  canConfirmSessions,
  windowOpeningMethods,
  mayReverifyWith,
} from './step-up';
export type { StepUpMethods, ReverifyFacts } from './step-up';
export {
  mfaMethodFromPath,
  isSessionMfaVerified,
  mfaConfirmedUntil,
  isMfaConfirmedRecently,
  sessionMfaOf,
  signedInAtOf,
} from './session';
export type { MfaMethod, SessionMfa, SessionMfaInput } from './session';
export { hasStrongMfa, strongMfaConfirmedUntil, strongStepUpMethods } from './strong';
export { mustSetUpMfa, mustStepUp, needsRecentConfirmation, needsFreshSignIn } from './actor-gates';
export type { ActorMfa } from './actor-gates';
export { signInMethodFromPath } from './sign-in-method';
export type { SignInMethod } from './sign-in-method';
