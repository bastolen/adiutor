/**
 * @file Tests for which roles require MFA and a user's MFA role.
 */
import { describe, expect, it } from 'vitest';

import { allowsEmailCodes } from './email-codes';
import { mfaRoleOf, requiresMfa } from './requirement';
import { isSessionMfaVerified } from './session';
import { hasMfa } from './state';
import { emailCodes, WITH_GITHUB } from './test-helpers';

describe('requiresMfa', () => {
  it('applies to staff Admins and Managers, and company Admins', () => {
    expect(requiresMfa('platform_admin')).toBe(true);
    expect(requiresMfa('manager')).toBe(true);
    expect(requiresMfa('company_admin')).toBe(true);
    expect(requiresMfa('finance')).toBe(false);
    expect(requiresMfa('support')).toBe(false);
    expect(requiresMfa(null)).toBe(false);
  });
});

describe('mfaRoleOf', () => {
  it.each([
    ['platform_admin', true, 'platform_admin'],
    ['manager', false, 'manager'],
    ['support', true, 'company_admin'],
    ['finance', false, 'finance'],
    [null, true, 'company_admin'],
    [null, false, null],
  ] as const)('staff role %s, Admin of an active company: %s → %s', (staff, admin, expected) => {
    expect(mfaRoleOf(staff, admin)).toBe(expected);
  });

  it('applies the strict rules to company Admins', () => {
    expect(hasMfa(emailCodes, 'company_admin', WITH_GITHUB)).toBe(false);
    expect(allowsEmailCodes(emailCodes, 'company_admin')).toBe(false);
    expect(
      isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'email_code' }, 'company_admin'),
    ).toBe(false);
    expect(
      isSessionMfaVerified({ mfaVerified: true, mfaMethod: 'authenticator' }, 'company_admin'),
    ).toBe(true);
  });
});
