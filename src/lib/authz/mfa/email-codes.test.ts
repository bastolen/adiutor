/**
 * @file Tests for when emailed codes may be used as a second step.
 */
import { describe, expect, it } from 'vitest';

import { allowsEmailCodes, allowsEmailCodesAtSignIn } from './email-codes';
import { authenticatorApp, emailCodes } from './test-helpers';

describe('email codes', () => {
  it('are never accepted once an authenticator app is set up', () => {
    expect(allowsEmailCodes(authenticatorApp, null)).toBe(false);
    expect(allowsEmailCodesAtSignIn(authenticatorApp)).toBe(false);
  });

  it("don't confirm sessions of roles that require MFA, but may finish their sign-in", () => {
    expect(allowsEmailCodes(emailCodes, 'manager')).toBe(false);
    expect(allowsEmailCodesAtSignIn(emailCodes)).toBe(true);
    expect(allowsEmailCodes(emailCodes, 'support')).toBe(true);
    expect(allowsEmailCodes(emailCodes, null)).toBe(true);
  });
});
