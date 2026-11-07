/**
 * @file Tests for the code step's URL.
 */
import { describe, expect, it } from 'vitest';

import { parseTwoFactorMethod, twoFactorPath } from './two-factor-path';

describe('twoFactorPath', () => {
  it('keeps the destination and the known methods', () => {
    expect(twoFactorPath('/companies/x', ['totp', 'otp', 'sms'])).toBe(
      '/auth/two-factor?callbackURL=%2Fcompanies%2Fx&methods=totp%2Cotp',
    );
    expect(twoFactorPath('/dashboard', [])).toBe('/auth/two-factor?callbackURL=%2Fdashboard');
  });
});

describe('parseTwoFactorMethod', () => {
  it('offers only the authenticator app when there is one, and falls back to email codes', () => {
    expect(parseTwoFactorMethod('otp,totp')).toBe('totp');
    expect(parseTwoFactorMethod('otp')).toBe('otp');
    expect(parseTwoFactorMethod('nonsense')).toBe('otp');
    expect(parseTwoFactorMethod(null)).toBe('otp');
  });
});
