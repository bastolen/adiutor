/**
 * @file Tests for the OAuth provider list: which providers can prove MFA,
 * how their names are joined in a sentence, how their accounts are named and
 * identified, and the next-page cookies (an account connected, a step-up
 * that didn't count).
 */
import { describe, expect, it } from 'vitest';

import {
  accountIdFromProfile,
  accountNameFromProfile,
  cleanAccountName,
  isMfaProvider,
  MAX_ACCOUNT_NAME_LENGTH,
  MFA_PROVIDERS,
  OAUTH_PROVIDERS,
  parseProviderLinkedCookie,
  parseProviderStepUpCookie,
  PROVIDER_ACCOUNT_ID_CLAIMS,
  PROVIDER_ACCOUNT_NAME_CLAIMS,
  PROVIDER_STEP_UP_OUTCOMES,
  providerLabel,
  providerLinkedCookieValue,
  providerList,
  providerStepUpCookieValue,
} from './oauth-providers';

describe('MFA_PROVIDERS', () => {
  it('only lists OAuth providers, GitHub among them and not Google', () => {
    MFA_PROVIDERS.forEach((provider) => expect(OAUTH_PROVIDERS).toContain(provider));
    expect(isMfaProvider('github')).toBe(true);
    expect(isMfaProvider('google')).toBe(false);
    expect(isMfaProvider('unknown')).toBe(false);
    expect(isMfaProvider(undefined)).toBe(false);
  });
});

describe('providerList', () => {
  it.each([
    ['en-US', 'GitHub or Google'],
    ['nl-NL', 'GitHub of Google'],
    ['es-ES', 'GitHub o Google'],
  ] as const)('joins names with the "or" of %s', (locale, expected) => {
    expect(providerList(['github', 'google'], locale)).toBe(expected);
    expect(providerList(['github'], locale)).toBe('GitHub');
  });
});

describe('providerLabel', () => {
  it('labels configured providers and shows other IDs as they are', () => {
    expect(providerLabel('github')).toBe('GitHub');
    expect(providerLabel('google')).toBe('Google');
    expect(providerLabel('gitlab')).toBe('gitlab');
  });
});

describe('account names', () => {
  it('are declared for every provider', () => {
    OAUTH_PROVIDERS.forEach((provider) =>
      expect(PROVIDER_ACCOUNT_NAME_CLAIMS[provider].length).toBeGreaterThan(0),
    );
  });

  it("come from GitHub's username and Google's email address", () => {
    // Shaped like GitHub's /user response and Google's ID token claims.
    const github = {
      id: 1,
      login: 'adiutor-tests',
      name: 'Adiutor Tests',
      email: 'a@adiutor.test',
    };
    const google = { sub: '1', email: 'jane@adiutor.test', name: 'Jane Tester' };

    expect(accountNameFromProfile('github', github)).toBe('adiutor-tests');
    expect(accountNameFromProfile('google', google)).toBe('jane@adiutor.test');
  });

  it('are left out when the profile has none, or only inherits one', () => {
    expect(accountNameFromProfile('github', { id: 1 })).toBeNull();
    expect(accountNameFromProfile('github', { login: 42 })).toBeNull();
    expect(accountNameFromProfile('github', null)).toBeNull();
    expect(accountNameFromProfile('github', 'adiutor-tests')).toBeNull();
    expect(accountNameFromProfile('github', Object.create({ login: 'inherited' }))).toBeNull();
  });

  it('lose characters that hide or reorder others, and extra spaces', () => {
    expect(cleanAccountName(' jane\u202E@adiutor.test ')).toBe('jane@adiutor.test');
    expect(cleanAccountName('ja\u200Bne\u0000')).toBe('jane');
    expect(cleanAccountName('Jane \n\t Tester')).toBe('Jane Tester');
    expect(cleanAccountName('e\u0301')).toBe('\u00E9');
  });

  it('are dropped, not cut, when empty or too long', () => {
    expect(cleanAccountName('\u200B \u202E')).toBeNull();
    expect(cleanAccountName('a'.repeat(MAX_ACCOUNT_NAME_LENGTH))).toHaveLength(
      MAX_ACCOUNT_NAME_LENGTH,
    );
    expect(cleanAccountName('a'.repeat(MAX_ACCOUNT_NAME_LENGTH + 1))).toBeNull();
    expect(cleanAccountName(undefined)).toBeNull();
  });
});

describe('account IDs', () => {
  it('are declared for every provider', () => {
    OAUTH_PROVIDERS.forEach((provider) =>
      expect(PROVIDER_ACCOUNT_ID_CLAIMS[provider]).not.toBe(''),
    );
  });

  it("come from GitHub's numeric ID and Google's subject, as Better Auth stores them", () => {
    // Shaped like GitHub's /user response and Google's ID token claims.
    expect(accountIdFromProfile('github', { id: 4242, login: 'adiutor-tests' })).toBe('4242');
    expect(accountIdFromProfile('google', { sub: '1234567890', email: 'jane@adiutor.test' })).toBe(
      '1234567890',
    );
  });

  it('are left out when the profile has no usable one, or only inherits one', () => {
    expect(accountIdFromProfile('github', { login: 'adiutor-tests' })).toBeNull();
    expect(accountIdFromProfile('github', { id: Number.NaN })).toBeNull();
    expect(accountIdFromProfile('github', { id: ' ' })).toBeNull();
    expect(accountIdFromProfile('github', { id: { nested: 1 } })).toBeNull();
    expect(accountIdFromProfile('google', { id: '1234567890' })).toBeNull();
    expect(accountIdFromProfile('github', null)).toBeNull();
    expect(accountIdFromProfile('github', '4242')).toBeNull();
    expect(accountIdFromProfile('github', Object.create({ id: 4242 }))).toBeNull();
  });
});

describe('the provider-linked cookie', () => {
  it('carries the provider and, when known, the account name', () => {
    expect(providerLinkedCookieValue('github', 'adiutor-tests')).toBe('github:adiutor-tests');
    expect(providerLinkedCookieValue('google', null)).toBe('google');
    expect(parseProviderLinkedCookie('github:adiutor-tests')).toEqual({
      provider: 'github',
      accountName: 'adiutor-tests',
    });
    expect(parseProviderLinkedCookie('google')).toEqual({ provider: 'google', accountName: null });
    // Only the first colon separates the name.
    expect(parseProviderLinkedCookie('google:a:b')).toEqual({
      provider: 'google',
      accountName: 'a:b',
    });
  });

  it('is cleaned again when read, since the browser can change it', () => {
    expect(parseProviderLinkedCookie('github:a\u202Eb')).toEqual({
      provider: 'github',
      accountName: 'ab',
    });
    expect(parseProviderLinkedCookie('gitlab:adiutor-tests')).toBeNull();
    expect(parseProviderLinkedCookie('')).toBeNull();
    expect(parseProviderLinkedCookie(undefined)).toBeNull();
  });
});

describe('the provider step-up cookie', () => {
  it('carries the provider and why it didn’t confirm the session, and reads back', () => {
    PROVIDER_STEP_UP_OUTCOMES.forEach((outcome) => {
      const value = providerStepUpCookieValue('github', outcome);
      expect(value).toBe(`github:${outcome}`);
      expect(parseProviderStepUpCookie(value)).toEqual({ provider: 'github', outcome });
    });
  });

  it('is only read for a provider that can prove MFA and a known outcome, since the browser can change it', () => {
    // Google can't prove MFA, so it never confirms a session on the step-up page.
    expect(parseProviderStepUpCookie('google:mfa-off')).toBeNull();
    expect(parseProviderStepUpCookie('gitlab:mfa-off')).toBeNull();
    expect(parseProviderStepUpCookie('github:confirmed')).toBeNull();
    // Another account than the user's own confirmed one is refused before signing in instead.
    expect(parseProviderStepUpCookie('github:unconfirmed')).toBeNull();
    expect(parseProviderStepUpCookie('github:mfa-off:adiutor-tests')).toBeNull();
    expect(parseProviderStepUpCookie('github')).toBeNull();
    expect(parseProviderStepUpCookie('github:')).toBeNull();
    expect(parseProviderStepUpCookie('')).toBeNull();
    expect(parseProviderStepUpCookie(null)).toBeNull();
    expect(parseProviderStepUpCookie(undefined)).toBeNull();
  });
});
