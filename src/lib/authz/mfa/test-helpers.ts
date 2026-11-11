/**
 * @file Account setups and sign-in changes shared by the MFA rule tests.
 */
import type { MfaRole } from './requirement';
import {
  type MfaDowngradeBlocks,
  type SignInChange,
  wouldRemoveRequiredMfa,
} from './sign-in-changes';
import type { MfaState, ProviderAvailability } from './state';

/** An account with nothing set up. */
export const bare: MfaState = {
  twoFactorEnabled: false,
  authenticator: false,
  passkeyCount: 0,
  hasPassword: true,
  providerAccounts: [],
};

/** Two-step verification with email codes only. */
export const emailCodes: MfaState = { ...bare, twoFactorEnabled: true };

/** Two-step verification with an authenticator app. */
export const authenticatorApp: MfaState = { ...bare, twoFactorEnabled: true, authenticator: true };

/** A GitHub account with two-factor authentication. */
export const githubWith2fa = { providerId: 'github', mfaVerified: true };

/** The row ID of the user's GitHub account. */
const GITHUB_ID = '01970000-0000-7000-8000-0000000000a1';

/** The user's GitHub account with two-factor authentication, as loaded from the database. */
export const githubLinked = { id: GITHUB_ID, providerId: 'github', mfaVerified: true };

/** An account that signs in only with GitHub with two-factor authentication. */
export const githubOnly: MfaState = {
  ...bare,
  hasPassword: false,
  providerAccounts: [githubLinked],
};

/** The kinds of sign-in change. */
type ChangeKind = SignInChange['kind'];

/**
 * One change of each kind; disconnecting is of the GitHub account, and
 * connecting is of a Google account whose MFA isn't known yet.
 */
export const CHANGES: readonly SignInChange[] = [
  { kind: 'remove_passkey' },
  { kind: 'turn_off_two_factor' },
  { kind: 'disconnect_provider', accountId: GITHUB_ID },
  { kind: 'set_password' },
  { kind: 'connect_provider', providerId: 'google' },
];

/** Roles that require MFA. */
export const REQUIRED_ROLES: readonly MfaRole[] = ['manager', 'platform_admin', 'company_admin'];

/** Roles that don't (and no role at all). */
export const OPTIONAL_ROLES: readonly (MfaRole | null)[] = [null, 'support', 'finance'];

/** GitHub sign-in isn't configured on the server (no provider that can prove MFA is). */
export const WITHOUT_GITHUB: ProviderAvailability = [];

/** GitHub sign-in is configured on the server. */
export const WITH_GITHUB: ProviderAvailability = ['github'];

/**
 * Account setups, with the changes refused for roles that require MFA (in the
 * order of {@link CHANGES}), and, where it differs, those refused when GitHub
 * sign-in isn't configured (GitHub with 2FA doesn't count then), and those
 * that would end the account's MFA for roles that don't require it (email
 * codes count for them; see `wouldEndMfa`).
 */
export const SETUPS: readonly {
  name: string;
  state: MfaState;
  refused: readonly ChangeKind[];
  refusedWithoutGitHub?: readonly ChangeKind[];
  endedForOtherRoles?: readonly ChangeKind[];
}[] = [
  { name: 'an authenticator app only', state: authenticatorApp, refused: ['turn_off_two_factor'] },
  { name: 'a passkey only', state: { ...bare, passkeyCount: 1 }, refused: ['remove_passkey'] },
  {
    name: 'a passkey and email codes',
    state: { ...emailCodes, passkeyCount: 1 },
    refused: ['remove_passkey'],
    // The email codes left over still count.
    endedForOtherRoles: [],
  },
  {
    name: 'an authenticator app and a passkey',
    state: { ...authenticatorApp, passkeyCount: 1 },
    refused: [],
  },
  { name: 'two passkeys', state: { ...bare, passkeyCount: 2 }, refused: [] },
  {
    name: 'GitHub with 2FA and no password',
    state: githubOnly,
    refused: ['disconnect_provider', 'set_password', 'connect_provider'],
    // Nothing to keep: without GitHub sign-in, it isn't MFA.
    refusedWithoutGitHub: [],
  },
  {
    name: 'GitHub with 2FA and a passkey',
    state: { ...githubOnly, passkeyCount: 1 },
    refused: [],
    // Without GitHub sign-in, the passkey is the only MFA left.
    refusedWithoutGitHub: ['remove_passkey'],
  },
  {
    name: 'email codes only',
    state: emailCodes,
    refused: [],
    endedForOtherRoles: ['turn_off_two_factor'],
  },
  { name: 'nothing', state: bare, refused: [] },
];

/**
 * Lists the changes that would take away the MFA a role requires.
 *
 * @param state - The account's setup.
 * @param role - The user's MFA role.
 * @param available - Which providers can be used.
 * @returns The kinds of the refused changes, in the order of {@link CHANGES}.
 */
export function refusedChanges(
  state: MfaState,
  role: MfaRole | null,
  available: ProviderAvailability,
): ChangeKind[] {
  return CHANGES.filter((change) => wouldRemoveRequiredMfa(state, role, change, available)).map(
    (change) => change.kind,
  );
}

/**
 * Works out what the Security page should refuse for the given refused
 * changes, with no accounts waiting for confirmation.
 *
 * @param refused - The kinds of the refused changes.
 * @returns The expected blocks.
 */
export function expectedBlocks(refused: readonly ChangeKind[]): MfaDowngradeBlocks {
  return {
    lastPasskey: refused.includes('remove_passkey'),
    turnOffTwoFactor: refused.includes('turn_off_two_factor'),
    disconnect: refused.includes('disconnect_provider') ? [GITHUB_ID] : [],
    setPassword: refused.includes('set_password'),
    connectProvider: refused.includes('connect_provider'),
    confirm: [],
  };
}
