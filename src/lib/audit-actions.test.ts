/**
 * @file Tests for describing audit events in the staff audit log, and for
 * the groups its filter offers (every event type in exactly one).
 */
import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_GROUP_KEYS,
  AUDIT_GROUPS,
  describeAuditEvent,
  isAuditGroup,
} from './audit-actions';

describe('describeAuditEvent', () => {
  it('says when a sign-out only ended some sessions', () => {
    expect(describeAuditEvent('sessions_revoked', { mfaRequired: true, count: 2 })).toBe(
      'Signed out of sessions without MFA, which the role now requires',
    );
    expect(describeAuditEvent('sessions_revoked', { others: true, count: 1 })).toBe(
      'Signed out of other devices',
    );
    expect(describeAuditEvent('sessions_revoked', { byAdmin: true })).toBe('Signed out everywhere');
  });

  it('tells a password whose sign-in waits for its code apart from a sign-in', () => {
    expect(describeAuditEvent('sign_in_code_pending', {})).toBe(
      'Password accepted, code step started',
    );
    expect(describeAuditEvent('sign_in', { method: 'password' })).toBe('Signed in');
  });

  it('tells a wrong code at sign-in from one on the step-up page', () => {
    expect(describeAuditEvent('mfa_failed', { method: 'authenticator', atSignIn: true })).toBe(
      'Wrong two-step verification code entered at sign-in',
    );
    expect(describeAuditEvent('mfa_failed', { method: 'authenticator' })).toBe(
      AUDIT_ACTION_LABELS.mfa_failed,
    );
  });

  it('says what a wrong current password was typed for', () => {
    expect(describeAuditEvent('password_check_failed', { purpose: 'change_password' })).toBe(
      'Wrong current password entered when changing the password',
    );
    expect(describeAuditEvent('password_check_failed', { purpose: 'deactivate' })).toBe(
      'Wrong current password entered when deactivating the account',
    );
    expect(describeAuditEvent('password_check_failed', {})).toBe(
      AUDIT_ACTION_LABELS.password_check_failed,
    );
  });

  it('uses the label for everything else', () => {
    expect(describeAuditEvent('role_changed', { mfaRequired: true })).toBe(
      AUDIT_ACTION_LABELS.role_changed,
    );
  });
});

describe('AUDIT_GROUPS', () => {
  it('puts every event type in exactly one group', () => {
    const grouped = AUDIT_GROUP_KEYS.flatMap((group) => AUDIT_GROUPS[group].actions);
    expect([...grouped].sort()).toEqual([...AUDIT_ACTIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('tells a group from anything else', () => {
    expect(isAuditGroup('people')).toBe(true);
    expect(isAuditGroup('everything')).toBe(false);
    expect(isAuditGroup(undefined)).toBe(false);
  });
});
