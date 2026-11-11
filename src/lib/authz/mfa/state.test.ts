/**
 * @file Tests for whether an account counts as protected by MFA, including
 * provider MFA and providers that aren't configured.
 */
import { describe, expect, it } from 'vitest';

import { mfaDowngradeBlocks } from './sign-in-changes';
import {
  givesMfa,
  hasMfa,
  mfaGivingProviders,
  type MfaState,
  mfaStatus,
  unavailableProviderMfa,
} from './state';
import { canConfirmSessions, NO_STEP_UP_METHODS, stepUpMethods } from './step-up';
import {
  authenticatorApp,
  bare,
  emailCodes,
  githubWith2fa,
  githubOnly,
  WITHOUT_GITHUB,
  WITH_GITHUB,
  REQUIRED_ROLES,
  OPTIONAL_ROLES,
  SETUPS,
  refusedChanges,
  expectedBlocks,
} from './test-helpers';

describe('hasMfa', () => {
  it('counts an authenticator app, any passkey, or email codes', () => {
    expect(hasMfa(authenticatorApp, null, WITH_GITHUB)).toBe(true);
    expect(hasMfa({ ...bare, passkeyCount: 1 }, null, WITH_GITHUB)).toBe(true);
    expect(hasMfa(emailCodes, null, WITH_GITHUB)).toBe(true);
    expect(hasMfa(bare, null, WITH_GITHUB)).toBe(false);
  });

  it("doesn't count email codes for roles that require MFA", () => {
    expect(hasMfa(emailCodes, 'manager', WITH_GITHUB)).toBe(false);
    expect(hasMfa(emailCodes, 'platform_admin', WITH_GITHUB)).toBe(false);
    expect(hasMfa(emailCodes, 'support', WITH_GITHUB)).toBe(true);
    expect(hasMfa(authenticatorApp, 'manager', WITH_GITHUB)).toBe(true);
    expect(hasMfa({ ...emailCodes, passkeyCount: 1 }, 'manager', WITH_GITHUB)).toBe(true);
  });

  it('counts provider MFA only without a password and when every provider account has it', () => {
    const googleWithout = { providerId: 'google', mfaVerified: false };
    expect(
      hasMfa({ ...bare, hasPassword: false, providerAccounts: [githubWith2fa] }, null, WITH_GITHUB),
    ).toBe(true);
    expect(
      hasMfa({ ...bare, hasPassword: true, providerAccounts: [githubWith2fa] }, null, WITH_GITHUB),
    ).toBe(false);
    expect(
      hasMfa(
        { ...bare, hasPassword: false, providerAccounts: [githubWith2fa, googleWithout] },
        null,
        WITH_GITHUB,
      ),
    ).toBe(false);
    expect(hasMfa({ ...bare, hasPassword: false, providerAccounts: [] }, null, WITH_GITHUB)).toBe(
      false,
    );
  });

  it('gives the matching status', () => {
    expect(mfaStatus(emailCodes, 'manager', WITH_GITHUB)).toBe('required');
    expect(mfaStatus(emailCodes, null, WITH_GITHUB)).toBe('protected');
    expect(mfaStatus(bare, null, WITH_GITHUB)).toBe('optional');
  });
});

describe('without GitHub sign-in configured', () => {
  it("doesn't count a GitHub-only account with 2FA as MFA", () => {
    expect(hasMfa(githubOnly, null, WITHOUT_GITHUB)).toBe(false);
    expect(hasMfa(githubOnly, 'manager', WITHOUT_GITHUB)).toBe(false);
    expect(mfaStatus(githubOnly, 'platform_admin', WITHOUT_GITHUB)).toBe('required');
    expect(mfaStatus(githubOnly, 'company_admin', WITHOUT_GITHUB)).toBe('required');
    expect(mfaStatus(githubOnly, 'support', WITHOUT_GITHUB)).toBe('optional');
    expect(mfaStatus(githubOnly, null, WITHOUT_GITHUB)).toBe('optional');
  });

  it("ignores the MFA flag of a provider that can't prove MFA, even if it were set", () => {
    const googleOnly: MfaState = {
      ...bare,
      hasPassword: false,
      providerAccounts: [{ providerId: 'google', mfaVerified: true }],
    };
    expect(hasMfa(googleOnly, 'manager', WITH_GITHUB)).toBe(false);
    expect(hasMfa(googleOnly, 'manager', WITHOUT_GITHUB)).toBe(false);
    expect(stepUpMethods(googleOnly, 'manager', WITH_GITHUB).providers).toEqual([]);
  });

  it('counts passkeys, an authenticator app and email codes as with GitHub', () => {
    const setups: readonly MfaState[] = [
      authenticatorApp,
      emailCodes,
      bare,
      { ...bare, passkeyCount: 1 },
      { ...githubOnly, passkeyCount: 1 },
      { ...githubOnly, twoFactorEnabled: true, authenticator: true },
    ];
    [...REQUIRED_ROLES, ...OPTIONAL_ROLES].forEach((role) => {
      setups.forEach((state) => {
        expect(hasMfa(state, role, WITHOUT_GITHUB)).toBe(hasMfa(state, role, WITH_GITHUB));
        expect(mfaStatus(state, role, WITHOUT_GITHUB)).toBe(mfaStatus(state, role, WITH_GITHUB));
      });
    });
    expect(hasMfa({ ...githubOnly, passkeyCount: 1 }, 'manager', WITHOUT_GITHUB)).toBe(true);
    expect(mfaStatus(authenticatorApp, 'manager', WITHOUT_GITHUB)).toBe('protected');
    expect(mfaStatus(emailCodes, 'manager', WITHOUT_GITHUB)).toBe('required');
  });

  describe.each(REQUIRED_ROLES)('for %s, whose role requires MFA', (role) => {
    it.each(
      SETUPS.map((setup) => {
        const refused = setup.refusedWithoutGitHub ?? setup.refused;
        return { ...setup, refused, refusing: refused.join(', ') || 'nothing' };
      }),
    )('with $name, refuses $refusing', ({ state, refused }) => {
      expect(refusedChanges(state, role, WITHOUT_GITHUB)).toEqual(refused);
      expect(mfaDowngradeBlocks(state, role, WITHOUT_GITHUB)).toEqual(expectedBlocks(refused));
    });
  });

  describe.each(OPTIONAL_ROLES)('for %s, whose role doesn’t require MFA', (role) => {
    it.each(SETUPS)('with $name, refuses nothing', ({ state }) => {
      expect(refusedChanges(state, role, WITHOUT_GITHUB)).toEqual([]);
      expect(mfaDowngradeBlocks(state, role, WITHOUT_GITHUB)).toEqual(expectedBlocks([]));
    });
  });
});

describe('ProviderAvailability', () => {
  /** A password account whose only second step is GitHub with two-factor authentication. */
  const githubAndPassword: MfaState = { ...bare, providerAccounts: [githubWith2fa] };

  it("doesn't offer GitHub when GitHub sign-in isn't configured, even with 2FA on it", () => {
    expect(stepUpMethods(githubAndPassword, null, WITHOUT_GITHUB).providers).toEqual([]);
    expect(stepUpMethods(githubAndPassword, 'manager', WITHOUT_GITHUB).providers).toEqual([]);
    expect(
      stepUpMethods({ ...githubAndPassword, hasPassword: false }, 'platform_admin', WITHOUT_GITHUB),
    ).toEqual(NO_STEP_UP_METHODS);
  });

  it('offers GitHub when configured, only for a GitHub account with 2FA', () => {
    expect(stepUpMethods(githubAndPassword, 'manager', WITH_GITHUB).providers).toEqual(['github']);
    expect(
      stepUpMethods(
        { ...bare, providerAccounts: [{ providerId: 'github', mfaVerified: false }] },
        'manager',
        WITH_GITHUB,
      ).providers,
    ).toEqual([]);
    // A provider that can't prove MFA is never offered, even with its flag set.
    expect(
      stepUpMethods(
        { ...bare, providerAccounts: [{ providerId: 'google', mfaVerified: true }] },
        null,
        WITH_GITHUB,
      ).providers,
    ).toEqual([]);
  });

  it.each(['platform_admin', 'manager', 'company_admin'] as const)(
    'lets %s confirm sessions with GitHub with 2FA only when GitHub sign-in is configured',
    (role) => {
      expect(canConfirmSessions(githubAndPassword, role, WITHOUT_GITHUB)).toBe(false);
      expect(canConfirmSessions(githubAndPassword, role, WITH_GITHUB)).toBe(true);
    },
  );

  it('still counts the other second steps without GitHub', () => {
    const withPasskey: MfaState = { ...githubAndPassword, passkeyCount: 1 };
    expect(canConfirmSessions(withPasskey, 'manager', WITHOUT_GITHUB)).toBe(true);
    expect(canConfirmSessions(authenticatorApp, 'manager', WITHOUT_GITHUB)).toBe(true);
  });

  it.each([
    { role: null, counts: true },
    { role: 'support', counts: true },
    { role: 'finance', counts: true },
    { role: 'company_admin', counts: false },
    { role: 'manager', counts: false },
    { role: 'platform_admin', counts: false },
  ] as const)('email codes confirm sessions for role $role: $counts', ({ role, counts }) => {
    expect(canConfirmSessions(emailCodes, role, WITHOUT_GITHUB)).toBe(counts);
    expect(canConfirmSessions(emailCodes, role, WITH_GITHUB)).toBe(counts);
    expect(stepUpMethods(emailCodes, role, WITH_GITHUB).email).toBe(counts);
  });
});

describe('givesMfa', () => {
  it('needs a configured provider that can prove MFA and said the account has it', () => {
    expect(givesMfa(githubWith2fa, WITH_GITHUB)).toBe(true);
    expect(givesMfa(githubWith2fa, WITHOUT_GITHUB)).toBe(false);
    expect(givesMfa({ ...githubWith2fa, mfaVerified: false }, WITH_GITHUB)).toBe(false);
    expect(givesMfa({ providerId: 'google', mfaVerified: true }, WITH_GITHUB)).toBe(false);
  });
});

describe('mfaGivingProviders', () => {
  it('names the configured providers whose accounts give MFA, each once', () => {
    const state: MfaState = {
      ...bare,
      providerAccounts: [
        githubWith2fa,
        { ...githubWith2fa },
        { providerId: 'google', mfaVerified: true },
      ],
    };
    expect(mfaGivingProviders(state, WITH_GITHUB)).toEqual(['github']);
    expect(mfaGivingProviders(state, WITHOUT_GITHUB)).toEqual([]);
    expect(
      mfaGivingProviders(
        { ...bare, providerAccounts: [{ ...githubWith2fa, mfaVerified: false }] },
        WITH_GITHUB,
      ),
    ).toEqual([]);
  });
});

describe('unavailableProviderMfa', () => {
  /** An Admin who signs in only with GitHub, with 2FA on. */
  const githubOnlyAdmin: MfaState = {
    ...bare,
    hasPassword: false,
    providerAccounts: [githubWith2fa],
  };

  it('names the providers that gave a role its MFA and aren’t configured now', () => {
    expect(unavailableProviderMfa(githubOnlyAdmin, 'platform_admin', WITHOUT_GITHUB)).toEqual([
      'github',
    ]);
    expect(unavailableProviderMfa(githubOnlyAdmin, 'company_admin', WITHOUT_GITHUB)).toEqual([
      'github',
    ]);
  });

  it('is empty while the provider is configured, with MFA another way, or without it anyway', () => {
    expect(unavailableProviderMfa(githubOnlyAdmin, 'platform_admin', WITH_GITHUB)).toEqual([]);
    expect(
      unavailableProviderMfa({ ...githubOnlyAdmin, passkeyCount: 1 }, 'manager', WITHOUT_GITHUB),
    ).toEqual([]);
    // Without 2FA at GitHub it was never MFA, and a role that doesn't require it isn't affected.
    expect(
      unavailableProviderMfa(
        { ...githubOnlyAdmin, providerAccounts: [{ ...githubWith2fa, mfaVerified: false }] },
        'manager',
        WITHOUT_GITHUB,
      ),
    ).toEqual([]);
    expect(unavailableProviderMfa(githubOnlyAdmin, 'support', WITHOUT_GITHUB)).toEqual([]);
    // A password next to it: GitHub never counted as MFA.
    expect(
      unavailableProviderMfa({ ...githubOnlyAdmin, hasPassword: true }, 'manager', WITHOUT_GITHUB),
    ).toEqual([]);
  });
});
