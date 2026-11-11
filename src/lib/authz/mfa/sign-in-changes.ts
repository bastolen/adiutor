/**
 * @file Changes to how a user signs in, and which of them would end MFA or leave
 * a role that requires MFA without it (the changes the Security page and
 * the guards refuse).
 */
import { type MfaRole, requiresMfa } from './requirement';
import { type MfaState, type ProviderAvailability, hasMfa } from './state';

/**
 * A change to how the user signs in that could leave them without MFA:
 * removing a passkey, turning off two-step verification, disconnecting a
 * provider account (by its account ID), setting a first password (provider
 * MFA only counts without one), or connecting another provider account or
 * confirming one connected at sign-in (`connect_provider`: provider MFA only
 * counts when every provider account has it). A newly connected account's MFA
 * isn't known until the provider has been asked, so without `mfaVerified` it's
 * taken as without; a confirmed account's is known (see
 * {@link confirmProviderChange}).
 */
export type SignInChange =
  | { kind: 'remove_passkey' }
  | { kind: 'turn_off_two_factor' }
  | { kind: 'disconnect_provider'; accountId: string }
  | { kind: 'set_password' }
  | { kind: 'connect_provider'; providerId: string; mfaVerified?: boolean };

/**
 * Works out an account's setup after a change.
 *
 * @param state - The setup now.
 * @param change - The change.
 * @returns The setup afterwards.
 */
function afterChange(state: MfaState, change: SignInChange): MfaState {
  switch (change.kind) {
    case 'remove_passkey':
      return { ...state, passkeyCount: Math.max(0, state.passkeyCount - 1) };
    case 'turn_off_two_factor':
      return { ...state, twoFactorEnabled: false, authenticator: false };
    case 'disconnect_provider':
      return {
        ...state,
        providerAccounts: state.providerAccounts.filter((item) => item.id !== change.accountId),
      };
    case 'set_password':
      return { ...state, hasPassword: true };
    case 'connect_provider':
      return {
        ...state,
        providerAccounts: [
          ...state.providerAccounts,
          { providerId: change.providerId, mfaVerified: change.mfaVerified ?? false },
        ],
      };
    default:
      return state;
  }
}

/**
 * Checks whether a change would leave an account that has MFA
 * ({@link hasMfa}) without it, whatever the user's role: e.g. a first
 * password next to provider MFA, or turning off the email codes of a role
 * for which they count. An account without MFA has none to lose. For roles
 * that require MFA such changes are always refused
 * ({@link wouldRemoveRequiredMfa}); other callers decide for themselves
 * which of them to refuse (the guards refuse a first password set through a
 * reset link for every role, `RESET_ENDS_PROVIDER_MFA`).
 *
 * @param state - The account's setup now.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param change - The change.
 * @param available - The configured providers that can prove MFA.
 * @returns Whether the account has MFA now and wouldn't afterwards.
 */
export function wouldEndMfa(
  state: MfaState,
  mfaRole: MfaRole | null,
  change: SignInChange,
  available: ProviderAvailability,
): boolean {
  return (
    hasMfa(state, mfaRole, available) && !hasMfa(afterChange(state, change), mfaRole, available)
  );
}

/**
 * Checks whether a change would leave a role that requires MFA without it
 * ({@link requiresMfa} and {@link wouldEndMfa}). Such changes are refused (on
 * the Security page, by the guards and by the services), so the account
 * never drops back to "MFA required but not set up", where a password or an
 * email link alone could set up a new method. The user adds another method
 * first.
 *
 * @param state - The account's setup now.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param change - The change.
 * @param available - The configured providers that can prove MFA.
 * @returns Whether it would take away the MFA their role requires.
 */
export function wouldRemoveRequiredMfa(
  state: MfaState,
  mfaRole: MfaRole | null,
  change: SignInChange,
  available: ProviderAvailability,
): boolean {
  return requiresMfa(mfaRole) && wouldEndMfa(state, mfaRole, change, available);
}

/**
 * Builds the change of confirming a provider account that was connected while
 * signing in with it, so it counts from then on. Unlike connecting a new
 * account, its provider and MFA are known (stored at its sign-in), so it's
 * judged with them: e.g. a second GitHub account with two-factor
 * authentication keeps GitHub counting as MFA, one without doesn't. Both the
 * Security page ({@link mfaDowngradeBlocks}) and the service that confirms it
 * (`confirmConnectedProvider`) build the change here, so they agree.
 *
 * @param account - The account being confirmed.
 * @param account.providerId - Its provider.
 * @param account.mfaVerified - Whether its provider said it has MFA.
 * @returns The change, for {@link wouldRemoveRequiredMfa} (and {@link givesMfa}).
 */
export function confirmProviderChange(account: { providerId: string; mfaVerified: boolean }): {
  kind: 'connect_provider';
  providerId: string;
  mfaVerified: boolean;
} {
  return {
    kind: 'connect_provider',
    providerId: account.providerId,
    mfaVerified: account.mfaVerified,
  };
}

/**
 * A provider account waiting for the user to confirm it (connected while
 * signing in with it, so it doesn't count yet and isn't in {@link MfaState}),
 * for {@link mfaDowngradeBlocks}.
 */
export interface UnconfirmedProviderAccount {
  /** The account row's ID. */
  id: string;
  /** Its provider. */
  providerId: string;
  /** Whether its provider said it has MFA (stored at its sign-in). */
  mfaVerified: boolean;
}

/** Which changes the Security page refuses because of {@link wouldRemoveRequiredMfa}. */
export interface MfaDowngradeBlocks {
  /** Removing a passkey (it's the last one, and nothing else counts). */
  lastPasskey: boolean;
  /** Turning off two-step verification (the authenticator app is what counts). */
  turnOffTwoFactor: boolean;
  /** Provider accounts (by account ID) that can't be disconnected. */
  disconnect: readonly string[];
  /** Setting a first password (it would stop provider MFA counting). */
  setPassword: boolean;
  /**
   * Connecting a new provider account, of any provider (the Connect buttons;
   * the guards check Better Auth's `/link-social` the same way): its MFA isn't
   * known until the provider has been asked, so it's taken as without.
   */
  connectProvider: boolean;
  /**
   * Provider accounts waiting for confirmation (by account ID, from those
   * given to {@link mfaDowngradeBlocks}) that can't be confirmed, each judged
   * with its own provider and MFA ({@link confirmProviderChange}).
   */
  confirm: readonly string[];
}

/**
 * Works out which changes the Security page refuses because the user's role
 * requires MFA and the change would take it away (see
 * {@link wouldRemoveRequiredMfa}).
 *
 * @param state - The account's setup.
 * @param mfaRole - Which MFA rules apply to the user (see {@link mfaRoleOf}), or `null`.
 * @param available - The configured providers that can prove MFA.
 * @param unconfirmed - The user's provider accounts waiting for confirmation (none by default).
 * @returns The refused changes.
 */
export function mfaDowngradeBlocks(
  state: MfaState,
  mfaRole: MfaRole | null,
  available: ProviderAvailability,
  unconfirmed: readonly UnconfirmedProviderAccount[] = [],
): MfaDowngradeBlocks {
  /**
   * Checks one change.
   *
   * @param change - The change.
   * @returns Whether it's refused.
   */
  const blocked = (change: SignInChange) =>
    wouldRemoveRequiredMfa(state, mfaRole, change, available);
  return {
    lastPasskey: state.passkeyCount > 0 && blocked({ kind: 'remove_passkey' }),
    turnOffTwoFactor: state.twoFactorEnabled && blocked({ kind: 'turn_off_two_factor' }),
    disconnect: state.providerAccounts
      .map((item) => item.id)
      .filter((id): id is string => id !== undefined)
      .filter((accountId) => blocked({ kind: 'disconnect_provider', accountId })),
    setPassword: !state.hasPassword && blocked({ kind: 'set_password' }),
    // Any provider: a newly connected account's MFA isn't known yet, so it's taken as without.
    connectProvider: blocked({ kind: 'connect_provider', providerId: 'unknown' }),
    confirm: unconfirmed
      .filter((account) => blocked(confirmProviderChange(account)))
      .map((account) => account.id),
  };
}
