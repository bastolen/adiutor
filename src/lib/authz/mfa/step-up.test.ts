/**
 * @file Tests for the ways a user can confirm their session, and which open the
 * window for changing sign-in methods.
 */
import { describe, expect, it } from 'vitest';

import { mfaConfirmedUntil, type MfaMethod } from './session';
import { hasMfa, type MfaState } from './state';
import {
  canConfirmSessions,
  hasStrongerStepThanProvider,
  mayReverifyWith,
  NO_STEP_UP_METHODS,
  type ReverifyFacts,
  type StepUpMethods,
  stepUpMethods,
  windowOpeningMethods,
} from './step-up';
import {
  authenticatorApp,
  emailCodes,
  bare,
  githubWith2fa,
  githubOnly,
  SETUPS,
  REQUIRED_ROLES,
  OPTIONAL_ROLES,
  WITH_GITHUB,
} from './test-helpers';

describe('stepUpMethods', () => {
  it('offers only the methods that count', () => {
    expect(stepUpMethods(authenticatorApp, null)).toEqual({
      authenticator: true,
      email: false,
      passkey: false,
      providers: [],
    });
    expect(stepUpMethods(emailCodes, null).email).toBe(true);
    expect(stepUpMethods(emailCodes, 'manager').email).toBe(false);
    expect(stepUpMethods({ ...bare, passkeyCount: 2 }, 'manager').passkey).toBe(true);
    // Each provider once, however many of its accounts have 2FA.
    expect(
      stepUpMethods({ ...bare, providerAccounts: [githubWith2fa, { ...githubWith2fa }] }, null)
        .providers,
    ).toEqual(['github']);
    expect(
      stepUpMethods(
        { ...bare, providerAccounts: [{ providerId: 'github', mfaVerified: false }] },
        null,
      ).providers,
    ).toEqual([]);
  });
});

describe('mayReverifyWith', () => {
  /** Signing in with the user's own GitHub account that they confirmed, from their live session. */
  const ownConfirmed: ReverifyFacts = {
    sessionLive: true,
    connected: true,
    ownAccount: true,
    confirmed: true,
  };

  it("lets the user's own confirmed account confirm their session", () => {
    expect(mayReverifyWith(ownConfirmed)).toBe(true);
  });

  it.each<[string, Partial<ReverifyFacts>]>([
    // Whoever controls the inbox can create a GitHub account with the user's address.
    [
      'a new account Better Auth would connect by its email address',
      { connected: false, ownAccount: false, confirmed: false },
    ],
    // It would sign the browser in as that user.
    ["another user's account", { ownAccount: false }],
    // It can't confirm anything until the user confirms it on the Security page.
    ["one of the user's own accounts that isn't confirmed", { confirmed: false }],
    // The session it would confirm was signed out (or expired) in the meantime.
    ['any account once the browser no longer has the session', { sessionLive: false }],
  ])('refuses %s', (_, facts) => {
    expect(mayReverifyWith({ ...ownConfirmed, ...facts })).toBe(false);
  });
});

describe('canConfirmSessions', () => {
  it('counts every second step the step-up page offers, also GitHub next to a password', () => {
    const githubAndPassword: MfaState = { ...bare, providerAccounts: [githubWith2fa] };
    expect(hasMfa(githubAndPassword, 'platform_admin')).toBe(false);
    expect(canConfirmSessions(githubAndPassword, 'platform_admin')).toBe(true);
    expect(canConfirmSessions(githubAndPassword, null)).toBe(true);
    expect(canConfirmSessions(authenticatorApp, null)).toBe(true);
    expect(canConfirmSessions({ ...bare, passkeyCount: 1 }, 'manager')).toBe(true);
    expect(canConfirmSessions(emailCodes, 'support')).toBe(true);
    // Email codes don't count for Managers, and GitHub without 2FA isn't a second step.
    expect(canConfirmSessions(emailCodes, 'manager')).toBe(false);
    expect(
      canConfirmSessions(
        { ...bare, providerAccounts: [{ ...githubWith2fa, mfaVerified: false }] },
        null,
      ),
    ).toBe(false);
    expect(canConfirmSessions(bare, null)).toBe(false);
  });
});

describe('hasStrongerStepThanProvider', () => {
  it('is a passkey, or two-step verification with an authenticator app', () => {
    expect(hasStrongerStepThanProvider({ ...bare, passkeyCount: 1 })).toBe(true);
    expect(hasStrongerStepThanProvider({ ...bare, passkeyCount: 3 })).toBe(true);
    expect(hasStrongerStepThanProvider(authenticatorApp)).toBe(true);
  });

  it('is not email codes, a password, a provider or an unfinished authenticator setup', () => {
    expect(hasStrongerStepThanProvider(emailCodes)).toBe(false);
    expect(hasStrongerStepThanProvider(bare)).toBe(false);
    expect(hasStrongerStepThanProvider(githubOnly)).toBe(false);
    expect(hasStrongerStepThanProvider({ ...bare, authenticator: true })).toBe(false);
  });
});

describe('windowOpeningMethods', () => {
  it('leaves out providers next to a passkey or an authenticator app, and says which', () => {
    expect(
      windowOpeningMethods({ ...NO_STEP_UP_METHODS, passkey: true, providers: ['github'] }),
    ).toEqual({
      ...NO_STEP_UP_METHODS,
      passkey: true,
      providers: [],
      providersHeldBack: ['github'],
    });
    expect(
      windowOpeningMethods({ ...NO_STEP_UP_METHODS, authenticator: true, providers: ['github'] }),
    ).toEqual({
      ...NO_STEP_UP_METHODS,
      authenticator: true,
      providers: [],
      providersHeldBack: ['github'],
    });
  });

  it('keeps providers that are the only strong step, also next to email codes', () => {
    const githubAlone = { ...NO_STEP_UP_METHODS, providers: ['github'] as const };
    expect(windowOpeningMethods(githubAlone)).toEqual(githubAlone);
    const withEmail = { ...githubAlone, email: true };
    expect(windowOpeningMethods(withEmail)).toEqual(withEmail);
  });

  it('changes nothing without providers', () => {
    const passkeyOnly = { ...NO_STEP_UP_METHODS, passkey: true };
    expect(windowOpeningMethods(passkeyOnly)).toEqual(passkeyOnly);
    expect(windowOpeningMethods(NO_STEP_UP_METHODS)).toEqual(NO_STEP_UP_METHODS);
  });

  /** Account setups with GitHub with 2FA, alone or next to other steps. */
  const GITHUB_SETUPS: readonly { name: string; state: MfaState }[] = [
    { name: 'GitHub only', state: githubOnly },
    { name: 'GitHub and a password', state: { ...githubOnly, hasPassword: true } },
    { name: 'GitHub and email codes', state: { ...githubOnly, twoFactorEnabled: true } },
    { name: 'GitHub and a passkey', state: { ...githubOnly, passkeyCount: 1 } },
    {
      name: 'GitHub and an authenticator app',
      state: { ...githubOnly, twoFactorEnabled: true, authenticator: true },
    },
    ...SETUPS,
  ];

  /**
   * The second factor each offered method would confirm the session with.
   *
   * @param methods - The offered methods.
   * @returns The second factors.
   */
  const confirmations = (methods: StepUpMethods): MfaMethod[] => [
    ...(methods.authenticator ? (['authenticator', 'backup_code'] as const) : []),
    ...(methods.email ? (['email_code'] as const) : []),
    ...(methods.passkey ? (['passkey'] as const) : []),
    ...methods.providers,
  ];

  describe.each([...REQUIRED_ROLES, ...OPTIONAL_ROLES])('for %s', (role) => {
    it.each(GITHUB_SETUPS)(
      'with $name, offers only methods that open the window, and one at least',
      ({ state }) => {
        const offered = windowOpeningMethods(stepUpMethods(state, role, WITH_GITHUB));

        expect(confirmations(offered).length > 0).toBe(
          canConfirmSessions(state, role, WITH_GITHUB),
        );
        confirmations(offered).forEach((mfaMethod) => {
          expect(
            mfaConfirmedUntil(
              { mfaVerified: true, mfaMethod, mfaVerifiedAt: new Date() },
              role,
              state,
            ),
          ).not.toBeNull();
        });
      },
    );
  });
});
