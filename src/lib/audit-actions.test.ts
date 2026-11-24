/**
 * @file Tests for describing audit events in the staff audit log, and for
 * the groups its filter offers (every event type in exactly one).
 */
import { describe, expect, it } from 'vitest';

import translator from '@/lib/i18n/translator';

import {
  AUDIT_ACTIONS,
  AUDIT_GROUP_KEYS,
  AUDIT_GROUPS,
  describeAuditEvent,
  isAuditGroup,
} from './audit-actions';

/** Describes an event in English (US), as the audit log shows it. */
const t = translator('en-US', 'audit');

describe('describeAuditEvent', () => {
  it('gives a key in the audit catalogue, for the reader to translate', () => {
    expect(describeAuditEvent('sign_in', {})).toBe('actions.sign_in');
    expect(describeAuditEvent('sessions_revoked', { others: true })).toBe(
      'events.sessionsRevokedOthers',
    );
    expect(translator('nl-NL', 'audit')(describeAuditEvent('sign_in', {}))).not.toBe('Signed in');
  });

  it('says when a sign-out only ended some sessions', () => {
    expect(t(describeAuditEvent('sessions_revoked', { mfaRequired: true, count: 2 }))).toBe(
      'Signed out of sessions without MFA, which the role now requires',
    );
    expect(t(describeAuditEvent('sessions_revoked', { others: true, count: 1 }))).toBe(
      'Signed out of other devices',
    );
    expect(t(describeAuditEvent('sessions_revoked', { byAdmin: true }))).toBe(
      'Signed out everywhere',
    );
  });

  it('tells a password whose sign-in waits for its code apart from a sign-in', () => {
    expect(t(describeAuditEvent('sign_in_code_pending', {}))).toBe(
      'Password accepted, code step started',
    );
    expect(t(describeAuditEvent('sign_in', { method: 'password' }))).toBe('Signed in');
  });

  it('tells a wrong code at sign-in from one on the step-up page', () => {
    expect(t(describeAuditEvent('mfa_failed', { method: 'authenticator', atSignIn: true }))).toBe(
      'Wrong two-step verification code entered at sign-in',
    );
    expect(t(describeAuditEvent('mfa_failed', { method: 'authenticator' }))).toBe(
      'Failed MFA confirmation',
    );
  });

  it('says what a wrong current password was typed for', () => {
    expect(t(describeAuditEvent('password_check_failed', { purpose: 'change_password' }))).toBe(
      'Wrong current password entered when changing the password',
    );
    expect(t(describeAuditEvent('password_check_failed', { purpose: 'deactivate' }))).toBe(
      'Wrong current password entered when deactivating the account',
    );
    expect(t(describeAuditEvent('password_check_failed', { purpose: 'enable_two_factor' }))).toBe(
      'Wrong current password entered when turning on two-step verification',
    );
    expect(t(describeAuditEvent('password_check_failed', { purpose: 'disable_two_factor' }))).toBe(
      'Wrong current password entered when turning off two-step verification',
    );
    expect(
      t(describeAuditEvent('password_check_failed', { purpose: 'generate_backup_codes' })),
    ).toBe('Wrong current password entered when creating new backup codes');
    expect(t(describeAuditEvent('password_check_failed', {}))).toBe(
      'Wrong current password entered',
    );
  });

  it('says why a sign-in as a user ended, unless the staff member went back', () => {
    expect(t(describeAuditEvent('impersonation_ended', { reason: 'expired' }))).toBe(
      'Sign-in as a user ended when its time was up',
    );
    expect(t(describeAuditEvent('impersonation_ended', { reason: 'no_longer_allowed' }))).toBe(
      'Sign-in as a user ended because it was no longer allowed',
    );
    expect(t(describeAuditEvent('impersonation_ended', { reason: 'session_ended' }))).toBe(
      'Sign-in as a user ended with the staff member’s own session',
    );
    expect(t(describeAuditEvent('impersonation_ended', { reason: 'stopped' }))).toBe(
      'Went back from signing in as a user',
    );
    // A detail that only looks like a reason (an object's own property names) is just the label.
    expect(t(describeAuditEvent('impersonation_ended', { reason: 'constructor' }))).toBe(
      'Went back from signing in as a user',
    );
  });

  it('tells an invite link whose use was undone from one that was used', () => {
    expect(
      t(describeAuditEvent('invite_link_claimed', { email: 'new@adiutor.test', undone: true })),
    ).toBe('Invite link made usable again because its email couldn’t be sent');
    expect(
      t(describeAuditEvent('invite_link_claimed', { email: 'new@adiutor.test', status: 'sent' })),
    ).toBe('Used an invite link');
  });

  it('tells someone who kept their role from someone who joined', () => {
    expect(
      t(describeAuditEvent('member_joined', { role: 'client', kept: true, invited: 'admin' })),
    ).toBe('Used an invitation and kept the role they had');
    expect(t(describeAuditEvent('member_joined', { role: 'admin' }))).toBe('Joined a company');
  });

  it('uses the label for everything else', () => {
    expect(t(describeAuditEvent('role_changed', { mfaRequired: true }))).toBe('Changed a role');
    expect(t(describeAuditEvent('sign_in', { reason: 'expired' }))).toBe('Signed in');
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
