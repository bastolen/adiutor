/**
 * @file Tests for the sign-in changes that would end MFA, and the ones the
 * Security page refuses.
 */
import { describe, expect, it } from 'vitest';

import { allowsEmailCodes, emailCodeStatus } from './email-codes';
import { type MfaRole, requiresMfa } from './requirement';
import {
  confirmProviderChange,
  mfaDowngradeBlocks,
  type SignInChange,
  type UnconfirmedProviderAccount,
  wouldEndMfa,
  wouldRemoveRequiredMfa,
} from './sign-in-changes';
import type { MfaState, ProviderAvailability } from './state';
import {
  bare,
  REQUIRED_ROLES,
  SETUPS,
  refusedChanges,
  expectedBlocks,
  OPTIONAL_ROLES,
  githubOnly,
  githubLinked,
  CHANGES,
  WITHOUT_GITHUB,
  WITH_GITHUB,
} from './test-helpers';

describe('the Security page rules', () => {
  it.each([
    { authenticator: true, role: null, status: 'replaced' },
    { authenticator: true, role: 'manager', status: 'replaced' },
    { authenticator: false, role: 'manager', status: 'not-for-role' },
    { authenticator: false, role: 'platform_admin', status: 'not-for-role' },
    { authenticator: false, role: 'support', status: 'available' },
    { authenticator: false, role: null, status: 'available' },
  ] as const)(
    'email codes are $status with authenticator $authenticator for role $role',
    ({ authenticator, role, status }) => {
      expect(emailCodeStatus({ authenticator }, role)).toBe(status);
      expect(status === 'available').toBe(
        allowsEmailCodes({ ...bare, twoFactorEnabled: true, authenticator }, role),
      );
    },
  );
});

describe('wouldRemoveRequiredMfa and mfaDowngradeBlocks', () => {
  describe.each(REQUIRED_ROLES)('for %s, whose role requires MFA', (role) => {
    it.each(SETUPS.map((setup) => ({ ...setup, refusing: setup.refused.join(', ') || 'nothing' })))(
      'with $name, refuses $refusing',
      ({ state, refused }) => {
        expect(refusedChanges(state, role)).toEqual(refused);
        expect(mfaDowngradeBlocks(state, role)).toEqual(expectedBlocks(refused));
      },
    );
  });

  describe.each(OPTIONAL_ROLES)('for %s, whose role doesn’t require MFA', (role) => {
    it.each(SETUPS)('with $name, refuses nothing', ({ state }) => {
      expect(refusedChanges(state, role)).toEqual([]);
      expect(mfaDowngradeBlocks(state, role)).toEqual(expectedBlocks([]));
    });
  });

  it('allows connecting another GitHub account with 2FA, but not one without', () => {
    /**
     * Connecting a second GitHub account.
     *
     * @param mfaVerified - Whether it has two-factor authentication, if known.
     * @returns The change.
     */
    const connect = (mfaVerified?: boolean): SignInChange => ({
      kind: 'connect_provider',
      providerId: 'github',
      mfaVerified,
    });
    expect(wouldRemoveRequiredMfa(githubOnly, 'manager', connect(true))).toBe(false);
    expect(wouldRemoveRequiredMfa(githubOnly, 'manager', connect(false))).toBe(true);
    // Until its MFA is known, a new account counts as without.
    expect(wouldRemoveRequiredMfa(githubOnly, 'manager', connect())).toBe(true);
  });

  it('changes nothing when disconnecting an account that isn’t there', () => {
    expect(
      wouldRemoveRequiredMfa(githubOnly, 'platform_admin', {
        kind: 'disconnect_provider',
        accountId: '01970000-0000-7000-8000-0000000000ff',
      }),
    ).toBe(false);
  });

  it('allows disconnecting one of two GitHub accounts with 2FA, as the other still counts', () => {
    const secondId = '01970000-0000-7000-8000-0000000000a2';
    const twoGitHub: MfaState = {
      ...githubOnly,
      providerAccounts: [githubLinked, { ...githubLinked, id: secondId }],
    };
    expect(
      wouldRemoveRequiredMfa(twoGitHub, 'company_admin', {
        kind: 'disconnect_provider',
        accountId: secondId,
      }),
    ).toBe(false);
    expect(mfaDowngradeBlocks(twoGitHub, 'company_admin').disconnect).toEqual([]);
  });

  it('only lists provider accounts with an ID as blocked from disconnecting', () => {
    const withoutId: MfaState = {
      ...githubOnly,
      providerAccounts: [{ providerId: 'github', mfaVerified: true }],
    };
    expect(mfaDowngradeBlocks(withoutId, 'manager')).toEqual({
      ...expectedBlocks(['set_password', 'connect_provider']),
      disconnect: [],
    });
  });
});

describe('wouldEndMfa', () => {
  /**
   * Lists the changes that would end an account's MFA.
   *
   * @param state - The account's setup.
   * @param role - The user's MFA role.
   * @param available - Which providers can be used; the rules' default when left out.
   * @returns The kinds of those changes, in the order of {@link CHANGES}.
   */
  const endingChanges = (state: MfaState, role: MfaRole | null, available?: ProviderAvailability) =>
    CHANGES.filter((change) => wouldEndMfa(state, role, change, available)).map(
      (change) => change.kind,
    );

  describe.each(REQUIRED_ROLES)('for %s, whose role requires MFA', (role) => {
    it.each(SETUPS.map((setup) => ({ ...setup, ending: setup.refused.join(', ') || 'nothing' })))(
      'with $name, is ended by $ending: the changes refused for the role',
      ({ state, refused }) => {
        expect(endingChanges(state, role)).toEqual(refused);
      },
    );
  });

  describe.each(OPTIONAL_ROLES)('for %s, whose role doesn’t require MFA', (role) => {
    it.each(
      SETUPS.map((setup) => {
        const ended = setup.endedForOtherRoles ?? setup.refused;
        return { ...setup, ended, ending: ended.join(', ') || 'nothing' };
      }),
    )('with $name, is ended by $ending', ({ state, ended }) => {
      expect(endingChanges(state, role)).toEqual(ended);
    });
  });

  it('is ended by a first password next to GitHub with 2FA alone, for any role', () => {
    [...REQUIRED_ROLES, ...OPTIONAL_ROLES].forEach((role) => {
      expect(wouldEndMfa(githubOnly, role, { kind: 'set_password' })).toBe(true);
      // Not with a passkey, which keeps counting.
      expect(wouldEndMfa({ ...githubOnly, passkeyCount: 1 }, role, { kind: 'set_password' })).toBe(
        false,
      );
      // Nor while GitHub sign-in is off: GitHub isn't MFA here then.
      expect(wouldEndMfa(githubOnly, role, { kind: 'set_password' }, WITHOUT_GITHUB)).toBe(false);
    });
  });

  // The cases wouldRemoveRequiredMfa covered before are its own tests above, unchanged.
  it('is what wouldRemoveRequiredMfa refuses for roles that require MFA, and nothing for others', () => {
    [...REQUIRED_ROLES, ...OPTIONAL_ROLES].forEach((role) => {
      SETUPS.forEach(({ state }) => {
        [...CHANGES, { kind: 'connect_provider', providerId: 'github', mfaVerified: true } as const]
          .flatMap((change) =>
            [WITH_GITHUB, WITHOUT_GITHUB].map((available) => ({ change, available })),
          )
          .forEach(({ change, available }) => {
            expect(wouldRemoveRequiredMfa(state, role, change, available)).toBe(
              requiresMfa(role) && wouldEndMfa(state, role, change, available),
            );
          });
      });
    });
  });
});

describe('confirming a provider account connected at sign-in', () => {
  /** A second GitHub account with two-factor authentication, waiting for confirmation. */
  const githubWith2faToConfirm: UnconfirmedProviderAccount = {
    id: '01970000-0000-7000-8000-0000000000b1',
    providerId: 'github',
    mfaVerified: true,
  };

  /** A second GitHub account without two-factor authentication, waiting for confirmation. */
  const githubWithout2faToConfirm: UnconfirmedProviderAccount = {
    id: '01970000-0000-7000-8000-0000000000b2',
    providerId: 'github',
    mfaVerified: false,
  };

  /** A Google account, waiting for confirmation. */
  const googleToConfirm: UnconfirmedProviderAccount = {
    id: '01970000-0000-7000-8000-0000000000b3',
    providerId: 'google',
    mfaVerified: false,
  };

  /** All three, as the Security page passes them. */
  const unconfirmed = [githubWith2faToConfirm, githubWithout2faToConfirm, googleToConfirm];

  it('builds the change from the account’s own provider and MFA', () => {
    expect(confirmProviderChange(githubWith2faToConfirm)).toEqual({
      kind: 'connect_provider',
      providerId: 'github',
      mfaVerified: true,
    });
    expect(confirmProviderChange(googleToConfirm)).toEqual({
      kind: 'connect_provider',
      providerId: 'google',
      mfaVerified: false,
    });
  });

  describe.each(REQUIRED_ROLES)('for %s, whose role requires MFA', (role) => {
    it('with GitHub with 2FA only, allows a GitHub account with 2FA but not the others', () => {
      const blocks = mfaDowngradeBlocks(githubOnly, role, WITH_GITHUB, unconfirmed);

      expect(blocks.confirm).toEqual([githubWithout2faToConfirm.id, googleToConfirm.id]);
      // Connecting a new account stays refused: its MFA isn't known until it's connected.
      expect(blocks.connectProvider).toBe(true);
      expect(blocks).toEqual({
        ...expectedBlocks(['disconnect_provider', 'set_password', 'connect_provider']),
        confirm: [githubWithout2faToConfirm.id, googleToConfirm.id],
      });
    });

    it('refuses Google even if its MFA flag were set, as Google can’t prove MFA', () => {
      const googleFlagged = { ...googleToConfirm, mfaVerified: true };
      expect(mfaDowngradeBlocks(githubOnly, role, WITH_GITHUB, [googleFlagged]).confirm).toEqual([
        googleFlagged.id,
      ]);
    });

    it('allows every one with a passkey to keep MFA with', () => {
      expect(
        mfaDowngradeBlocks({ ...githubOnly, passkeyCount: 1 }, role, WITH_GITHUB, unconfirmed)
          .confirm,
      ).toEqual([]);
    });

    it('allows every one without GitHub sign-in, as there is no MFA to keep then', () => {
      expect(mfaDowngradeBlocks(githubOnly, role, WITHOUT_GITHUB, unconfirmed).confirm).toEqual([]);
    });
  });

  describe.each(OPTIONAL_ROLES)('for %s, whose role doesn’t require MFA', (role) => {
    it('allows every one', () => {
      expect(mfaDowngradeBlocks(githubOnly, role, WITH_GITHUB, unconfirmed).confirm).toEqual([]);
    });
  });

  it('judges each account with confirmProviderChange, for every setup and role', () => {
    const googleFlagged = { ...googleToConfirm, id: '01970000-0000-7000-8000-0000000000b4' };
    const accounts = [...unconfirmed, { ...googleFlagged, mfaVerified: true }];
    [WITH_GITHUB, WITHOUT_GITHUB].forEach((available) => {
      [...REQUIRED_ROLES, ...OPTIONAL_ROLES].forEach((role) => {
        SETUPS.forEach(({ state }) => {
          expect(mfaDowngradeBlocks(state, role, available, accounts).confirm).toEqual(
            accounts
              .filter((account) =>
                wouldRemoveRequiredMfa(state, role, confirmProviderChange(account), available),
              )
              .map((account) => account.id),
          );
        });
      });
    });
  });
});
