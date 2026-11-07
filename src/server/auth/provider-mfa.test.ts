/**
 * @file Tests for reading the providers' answers about two-factor
 * authentication.
 */
import { describe, expect, it } from 'vitest';

import { githubHasTwoFactor } from './provider-mfa';

describe('githubHasTwoFactor', () => {
  it('is true only when GitHub says two-factor authentication is on', () => {
    expect(githubHasTwoFactor({ login: 'adiutor', two_factor_authentication: true })).toBe(true);
    expect(githubHasTwoFactor({ two_factor_authentication: false })).toBe(false);
    expect(githubHasTwoFactor({ login: 'adiutor' })).toBeNull();
    expect(githubHasTwoFactor({ two_factor_authentication: 'yes' })).toBeNull();
    expect(githubHasTwoFactor(null)).toBeNull();
  });
});
