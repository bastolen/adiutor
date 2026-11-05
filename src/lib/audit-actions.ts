/**
 * @file The events the audit log records, with how they're shown.
 */

/** Every audit event type. */
export const AUDIT_ACTIONS = [
  'sign_in',
  'sign_in_failed',
  'sign_in_code_pending',
  'mfa_verified',
  'mfa_failed',
  'two_factor_enabled',
  'two_factor_disabled',
  'backup_codes_regenerated',
  'passkey_added',
  'passkey_removed',
  'password_changed',
  'password_reset',
  'password_check_failed',
  'provider_connected',
  'provider_confirmed',
  'provider_disconnected',
  'email_verified',
  'session_revoked',
  'sessions_revoked',
  'account_deactivated',
  'account_reactivated',
  'account_deleted',
  'account_created',
  'mfa_reset',
  'member_joined',
  'member_added',
  'member_removed',
  'role_changed',
  'invitation_sent',
  'invitation_revoked',
  'invite_link_created',
  'invite_link_claimed',
  'invite_link_revoked',
  'company_created',
  'company_updated',
  'company_deactivated',
  'company_reactivated',
  'staff_renamed',
] as const;

/** One audit event type. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** How each event type is described in the activity timeline. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  sign_in: 'Signed in',
  sign_in_failed: 'Failed sign-in attempt',
  sign_in_code_pending: 'Password accepted, code step started',
  mfa_verified: 'Verified a sign-in with MFA',
  mfa_failed: 'Failed MFA confirmation',
  two_factor_enabled: 'Turned on two-step verification',
  two_factor_disabled: 'Turned off two-step verification',
  backup_codes_regenerated: 'Created new backup codes',
  passkey_added: 'Added a passkey',
  passkey_removed: 'Removed a passkey',
  password_changed: 'Changed the password',
  password_reset: 'Reset the password',
  password_check_failed: 'Wrong current password entered',
  provider_connected: 'Connected a sign-in provider',
  provider_confirmed: 'Confirmed a sign-in provider',
  provider_disconnected: 'Disconnected a sign-in provider',
  email_verified: 'Verified the email address',
  session_revoked: 'Signed out a device',
  sessions_revoked: 'Signed out everywhere',
  account_deactivated: 'Deactivated the account',
  account_reactivated: 'Reactivated the account',
  account_deleted: 'Deleted the account',
  account_created: 'Created the account',
  mfa_reset: 'Reset two-step verification',
  member_joined: 'Joined a company',
  member_added: 'Added a member',
  member_removed: 'Removed a member',
  role_changed: 'Changed a role',
  invitation_sent: 'Sent an invitation',
  invitation_revoked: 'Revoked an invitation',
  invite_link_created: 'Created an invite link',
  invite_link_claimed: 'Used an invite link',
  invite_link_revoked: 'Revoked an invite link',
  company_created: 'Added a company',
  company_updated: 'Changed company details',
  company_deactivated: 'Deactivated a company',
  company_reactivated: 'Reactivated a company',
  staff_renamed: 'Changed the name shown to users',
};

/** The groups the staff audit log can be narrowed to, in the order they're offered. */
export const AUDIT_GROUP_KEYS = [
  'sign-ins',
  'sign-in-methods',
  'accounts',
  'people',
  'companies',
] as const;

/** A group of audit event types (see {@link AUDIT_GROUPS}). */
export type AuditGroup = (typeof AUDIT_GROUP_KEYS)[number];

/**
 * Each group's label and event types, for the audit log's filter. Every
 * event type belongs to exactly one group.
 */
export const AUDIT_GROUPS: Record<AuditGroup, { label: string; actions: readonly AuditAction[] }> =
  {
    'sign-ins': {
      label: 'Sign-ins',
      actions: [
        'sign_in',
        'sign_in_failed',
        'sign_in_code_pending',
        'mfa_verified',
        'mfa_failed',
        'password_check_failed',
        'session_revoked',
        'sessions_revoked',
      ],
    },
    'sign-in-methods': {
      label: 'Sign-in methods',
      actions: [
        'two_factor_enabled',
        'two_factor_disabled',
        'backup_codes_regenerated',
        'passkey_added',
        'passkey_removed',
        'password_changed',
        'password_reset',
        'provider_connected',
        'provider_confirmed',
        'provider_disconnected',
        'email_verified',
        'mfa_reset',
      ],
    },
    accounts: {
      label: 'Accounts',
      actions: ['account_created', 'account_deactivated', 'account_reactivated', 'account_deleted'],
    },
    people: {
      label: 'People',
      actions: [
        'member_joined',
        'member_added',
        'member_removed',
        'role_changed',
        'invitation_sent',
        'invitation_revoked',
        'invite_link_created',
        'invite_link_claimed',
        'invite_link_revoked',
      ],
    },
    companies: {
      label: 'Companies and staff',
      actions: [
        'company_created',
        'company_updated',
        'company_deactivated',
        'company_reactivated',
        'staff_renamed',
      ],
    },
  };

/**
 * Whether a value names an audit group, e.g. from a query parameter.
 *
 * @param value - The value.
 * @returns Whether it's one of {@link AUDIT_GROUP_KEYS}.
 */
export function isAuditGroup(value: unknown): value is AuditGroup {
  return (AUDIT_GROUP_KEYS as readonly unknown[]).includes(value);
}

/**
 * Describes an event for the staff audit log: its label, or a more precise
 * one where the details change what happened (a sign-out that ended only
 * some sessions, a wrong code at sign-in rather than on the step-up page,
 * what a wrong current password was typed for).
 *
 * @param action - What happened.
 * @param details - The event's details.
 * @returns The description.
 */
export function describeAuditEvent(action: AuditAction, details: Record<string, unknown>): string {
  if (action === 'sessions_revoked' && details.mfaRequired) {
    return 'Signed out of sessions without MFA, which the role now requires';
  }
  if (action === 'sessions_revoked' && details.others) {
    return 'Signed out of other devices';
  }
  // A wrong code at a password sign-in's code step, rather than on the step-up page.
  if (action === 'mfa_failed' && details.atSignIn === true) {
    return 'Wrong two-step verification code entered at sign-in';
  }
  // Recorded by `checkCurrentPassword`, with what the password was asked for.
  if (action === 'password_check_failed' && details.purpose === 'change_password') {
    return 'Wrong current password entered when changing the password';
  }
  if (action === 'password_check_failed' && details.purpose === 'deactivate') {
    return 'Wrong current password entered when deactivating the account';
  }
  return AUDIT_ACTION_LABELS[action];
}
