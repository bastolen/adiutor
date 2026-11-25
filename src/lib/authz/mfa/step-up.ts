/**
 * @file The ways a user can confirm their session with a second step (step-up),
 * and which of them open the window for changing sign-in methods.
 */
import { type MfaProvider } from '../../sign-in/oauth-providers';
import { allowsEmailCodes } from './email-codes';
import type { MfaRole } from './requirement';
import { type MfaState, type ProviderAvailability, mfaGivingProviders } from './state';

/** The ways a user can confirm a session that didn't have a second step. */
export interface StepUpMethods {
  /** A code from their authenticator app (and so also a backup code). */
  authenticator: boolean;
  /** An emailed code (see {@link allowsEmailCodes}). */
  email: boolean;
  /** One of their passkeys. */
  passkey: boolean;
  /**
   * Signing in again with one of these providers, whose account there has
   * two-factor authentication (configured providers that can prove MFA, in
   * the order of `MFA_PROVIDERS`).
   */
  providers: readonly MfaProvider[];
  /**
   * Providers the account could confirm with that aren't offered, because
   * next to a passkey or an authenticator app they wouldn't open the window
   * for changing sign-in methods (set by {@link windowOpeningMethods} when it
   * leaves any out), so the step-up page can say why they're missing.
   */
  providersHeldBack?: readonly MfaProvider[];
}

/**
 * Works out how a user can confirm their session on the step-up page (to
 * confirm a change to how they sign in, narrowed by
 * {@link windowOpeningMethods}).
 *
 * @param state - The account's setup.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param available - The configured providers that can prove MFA; a provider
 *   only counts while it's configured.
 * @returns The available methods.
 */
export function stepUpMethods(
  state: MfaState,
  mfaRole: MfaRole | null,
  available: ProviderAvailability,
): StepUpMethods {
  return {
    authenticator: state.twoFactorEnabled && state.authenticator,
    email: state.twoFactorEnabled && allowsEmailCodes(state, mfaRole),
    passkey: state.passkeyCount > 0,
    providers: mfaGivingProviders(state, available),
  };
}

/**
 * Checks whether the account has a second step that can confirm a session
 * (one of {@link stepUpMethods}), even when it doesn't count as the account's
 * MFA: e.g. a provider account with two-factor authentication on an account
 * that also has a password. Such an account must confirm with it before its sign-in methods
 * change, so a password set through an emailed reset link, or an email-link
 * session, can't add a new way in by itself.
 *
 * @param state - The account's setup.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param available - The configured providers that can prove MFA.
 * @returns Whether a session can be confirmed with a second step.
 */
export function canConfirmSessions(
  state: MfaState,
  mfaRole: MfaRole | null,
  available: ProviderAvailability,
): boolean {
  const methods = stepUpMethods(state, mfaRole, available);
  return methods.authenticator || methods.email || methods.passkey || methods.providers.length > 0;
}

/**
 * Checks whether the account has a stronger second step than a provider
 * that can prove MFA: a passkey, or two-step verification with an
 * authenticator app. A provider only reports that its account has
 * two-factor authentication, not that this sign-in used it (GitHub doesn't
 * ask for it again on a browser already signed in there), so on such an
 * account a provider confirmation doesn't open the window for changing
 * sign-in methods ({@link mfaConfirmedUntil}); it still confirms the session
 * ({@link isSessionMfaVerified}).
 *
 * @param state - The account's setup; only its passkeys and authenticator app matter.
 * @returns Whether it has a passkey or an authenticator app.
 */
export function hasStrongerStepThanProvider(
  state: Pick<MfaState, 'passkeyCount' | 'twoFactorEnabled' | 'authenticator'>,
): boolean {
  return state.passkeyCount > 0 || (state.twoFactorEnabled && state.authenticator);
}

/**
 * Narrows the step-up methods to those that open the window for changing
 * sign-in methods ({@link mfaConfirmedUntil}), for the step-up page when it
 * confirms such a change: providers are left out when a passkey or an
 * authenticator app is offered, as they don't open it then
 * ({@link hasStrongerStepThanProvider}). It never leaves an account that can
 * confirm sessions ({@link canConfirmSessions}) without a method: a provider
 * is only left out next to one of those. The providers it leaves out are
 * listed in `providersHeldBack`.
 *
 * @param methods - The account's step-up methods ({@link stepUpMethods}).
 * @returns The methods that open the window.
 */
export function windowOpeningMethods(methods: StepUpMethods): StepUpMethods {
  if (methods.providers.length === 0 || (!methods.passkey && !methods.authenticator)) {
    return methods;
  }
  return { ...methods, providers: [], providersHeldBack: methods.providers };
}

/**
 * What's known when a provider answers a re-verify ("Confirm with GitHub" on
 * the step-up page), before Better Auth connects an account or creates a
 * session, for {@link mayReverifyWith}.
 */
export interface ReverifyFacts {
  /** Whether the browser still has the live session the re-verify started from. */
  sessionLive: boolean;
  /**
   * Whether the provider account that signed in is connected already (Better
   * Auth signs in with it), rather than one Better Auth would connect now
   * because its verified email address matches an Adiutor account.
   */
  connected: boolean;
  /** Whether that account belongs to the re-verifying user, who Better Auth resolved too. */
  ownAccount: boolean;
  /** Whether the user confirmed that account as a second step (`account.confirmed`). */
  confirmed: boolean;
}

/**
 * Checks whether a re-verify may go ahead with the provider account that
 * signed in: only an existing account of the re-verifying user that they
 * confirmed, from the browser whose session it confirms. Not a new
 * connection (whoever controls the inbox could create one), not another
 * user's account (it would sign the browser in as them), and not one of
 * their own that isn't confirmed (it can't confirm anything). Whether that
 * account's two-factor authentication makes it count is still the
 * provider's answer afterwards.
 *
 * @param facts - What's known about the account and the browser.
 * @returns Whether the re-verify may go ahead; otherwise it's refused.
 */
export function mayReverifyWith(facts: ReverifyFacts): boolean {
  return facts.sessionLive && facts.connected && facts.ownAccount && facts.confirmed;
}
