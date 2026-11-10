/**
 * @file An account's sign-in setup and whether it counts as protected by MFA,
 * including provider MFA from the providers configured here.
 */
import { MFA_PROVIDERS, type MfaProvider } from '../../sign-in/oauth-providers';
import { type MfaRole, requiresMfa } from './requirement';

/** An account's sign-in setup, as far as MFA is concerned. */
export interface MfaState {
  /** Whether two-step verification (authenticator app or email codes) is on. */
  twoFactorEnabled: boolean;
  /** Whether an authenticator app is set up; without it, two-step verification means email codes. */
  authenticator: boolean;
  /** How many passkeys the user has. */
  passkeyCount: number;
  /** Whether the user has a password. */
  hasPassword: boolean;
  /**
   * The user's provider accounts: which provider, whether its provider says
   * it's protected with MFA (only ever for providers that can prove it), and
   * its account ID (when loaded from the database).
   */
  providerAccounts: readonly { id?: string; providerId: string; mfaVerified: boolean }[];
}

/**
 * The providers that can prove MFA and are configured on this server (see
 * `availableProviders` in `src/lib/sign-in/providers.ts`): provider MFA only counts
 * for these.
 */
export type ProviderAvailability = readonly MfaProvider[];

/** Every provider that can prove MFA, as if all were configured: the rules' default. */
export const ALL_MFA_PROVIDERS: ProviderAvailability = MFA_PROVIDERS;

/**
 * Checks whether a provider account can give MFA here: its provider can
 * prove MFA, is configured, and said the account has it.
 *
 * @param account - The provider account.
 * @param account.providerId - Its provider.
 * @param account.mfaVerified - Whether its provider said it has MFA.
 * @param available - The configured providers that can prove MFA (all of them by default).
 * @returns Whether it counts.
 */
export function givesMfa(
  account: { providerId: string; mfaVerified: boolean },
  available: ProviderAvailability = ALL_MFA_PROVIDERS,
): boolean {
  return account.mfaVerified && available.includes(account.providerId as MfaProvider);
}

/**
 * Checks whether an account is protected with MFA:
 * - an authenticator app is set up, or
 * - it has a passkey (multi-factor by itself: the device plus a fingerprint,
 *   face or PIN), or
 * - it has no password and signs in only with provider accounts that are all
 *   protected with MFA themselves, each from a provider that can prove it
 *   and is configured on this server (otherwise it can't be used), or
 * - email codes are on, except for roles that require MFA: for them, email
 *   codes don't count.
 *
 * @param state - The account's setup.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param available - The configured providers that can prove MFA (all of them by default).
 * @returns Whether it counts as protected.
 */
export function hasMfa(
  state: MfaState,
  mfaRole: MfaRole | null = null,
  available: ProviderAvailability = ALL_MFA_PROVIDERS,
): boolean {
  const { twoFactorEnabled, authenticator, passkeyCount, hasPassword, providerAccounts } = state;
  if (passkeyCount > 0) {
    return true;
  }
  if (twoFactorEnabled && (authenticator || !requiresMfa(mfaRole))) {
    return true;
  }
  return (
    !hasPassword &&
    providerAccounts.length > 0 &&
    providerAccounts.every((account) => givesMfa(account, available))
  );
}

/**
 * Lists the providers whose accounts give the user MFA here (a configured
 * provider that can prove MFA, and said the account has it), e.g. to name
 * them when a change would end it.
 *
 * @param state - The account's setup.
 * @param available - The configured providers that can prove MFA.
 * @returns Those providers, in the order of `MFA_PROVIDERS`.
 */
export function mfaGivingProviders(
  state: MfaState,
  available: ProviderAvailability,
): MfaProvider[] {
  return MFA_PROVIDERS.filter((provider) =>
    state.providerAccounts.some(
      (account) => account.providerId === provider && givesMfa(account, available),
    ),
  );
}

/**
 * Checks whether a role that requires MFA only lacks it because a provider
 * that gives it isn't configured here: the account would have MFA if every
 * provider that can prove MFA were configured. Such users are asked to set
 * up a passkey or an authenticator app, and so is whoever controls their
 * inbox; staff are warned (see `getProviderMfaWarning`).
 *
 * @param state - The account's setup.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param available - The configured providers that can prove MFA.
 * @returns The providers it relied on that aren't configured, or none when it isn't affected.
 */
export function unavailableProviderMfa(
  state: MfaState,
  mfaRole: MfaRole | null,
  available: ProviderAvailability,
): MfaProvider[] {
  if (!requiresMfa(mfaRole) || hasMfa(state, mfaRole, available)) {
    return [];
  }
  if (!hasMfa(state, mfaRole, ALL_MFA_PROVIDERS)) {
    return [];
  }
  return MFA_PROVIDERS.filter(
    (provider) =>
      !available.includes(provider) &&
      state.providerAccounts.some((account) => account.providerId === provider),
  );
}

/**
 * How an account stands with MFA, for badges in user lists:
 * - `protected`: it meets the rules of {@link hasMfa};
 * - `optional`: it doesn't, and its role doesn't require it;
 * - `required`: it doesn't, but its role requires it (they'll be asked to set
 *   it up at their next visit).
 */
export type MfaStatus = 'protected' | 'optional' | 'required';

/**
 * Works out how an account stands with MFA.
 *
 * @param state - The account's setup.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param available - The configured providers that can prove MFA (all of them by default).
 * @returns The status.
 */
export function mfaStatus(
  state: MfaState,
  mfaRole: MfaRole | null,
  available: ProviderAvailability = ALL_MFA_PROVIDERS,
): MfaStatus {
  if (hasMfa(state, mfaRole, available)) {
    return 'protected';
  }
  return requiresMfa(mfaRole) ? 'required' : 'optional';
}
