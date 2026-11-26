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
  'staff_sign_in_turned_off',
  'staff_sign_in_turned_on',
  'session_revoked',
  'sessions_revoked',
  'impersonation_started',
  'impersonation_ended',
  'request_subscribers_changed',
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
  'attachment_storage_changed',
  'attachment_storage_set_up',
  'brand_colours_changed',
  'request_type_added',
  'request_type_changed',
  'request_type_archived',
  'request_type_restored',
  'webhook_added',
  'webhook_changed',
  'webhook_secret_renewed',
  'webhook_turned_off',
  'webhook_turned_on',
  'webhook_removed',
  'job_started',
  'job_paused',
  'job_resumed',
  'queued_jobs_retried',
  'queued_jobs_discarded',
] as const;

/** One audit event type. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Actions only the staff who see the audit log read, never the user they're
 * about in their own Recent activity: a subscription changed by a staff
 * member signed in as them (decision 0025), which the request itself never
 * shows.
 */
export const STAFF_ONLY_AUDIT_ACTIONS: readonly AuditAction[] = ['request_subscribers_changed'];

/** The groups the staff audit log can be narrowed to, in the order they're offered. */
export const AUDIT_GROUP_KEYS = [
  'sign-ins',
  'sign-in-methods',
  'accounts',
  'people',
  'companies',
  'jobs',
] as const;

/** A group of audit event types (see {@link AUDIT_GROUPS}). */
export type AuditGroup = (typeof AUDIT_GROUP_KEYS)[number];

/**
 * Each group's event types; the audit log's filter names the group with
 * `audit.groups.<group>`. Every event type belongs to exactly one group.
 */
export const AUDIT_GROUPS: Record<AuditGroup, { actions: readonly AuditAction[] }> = {
  'sign-ins': {
    actions: [
      'sign_in',
      'sign_in_failed',
      'sign_in_code_pending',
      'mfa_verified',
      'mfa_failed',
      'password_check_failed',
      'session_revoked',
      'sessions_revoked',
      'impersonation_started',
      'impersonation_ended',
      'request_subscribers_changed',
    ],
  },
  'sign-in-methods': {
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
      'staff_sign_in_turned_off',
      'staff_sign_in_turned_on',
    ],
  },
  accounts: {
    actions: ['account_created', 'account_deactivated', 'account_reactivated', 'account_deleted'],
  },
  people: {
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
    actions: [
      'company_created',
      'company_updated',
      'company_deactivated',
      'company_reactivated',
      'staff_renamed',
      'attachment_storage_changed',
      'attachment_storage_set_up',
      'brand_colours_changed',
      'request_type_added',
      'request_type_changed',
      'request_type_archived',
      'request_type_restored',
      'webhook_added',
      'webhook_changed',
      'webhook_secret_renewed',
      'webhook_turned_off',
      'webhook_turned_on',
      'webhook_removed',
    ],
  },
  jobs: {
    actions: [
      'job_started',
      'job_paused',
      'job_resumed',
      'queued_jobs_retried',
      'queued_jobs_discarded',
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
 * The more precise descriptions some events get, keys of `audit.events`
 * (see {@link describeAuditEvent}).
 */
type AuditEventDescription =
  | 'sessionsRevokedMfaRequired'
  | 'sessionsRevokedOthers'
  | 'mfaFailedAtSignIn'
  | 'passwordCheckFailedChangePassword'
  | 'passwordCheckFailedDeactivate'
  | 'passwordCheckFailedEnableTwoFactor'
  | 'passwordCheckFailedDisableTwoFactor'
  | 'passwordCheckFailedBackupCodes'
  | 'impersonationExpired'
  | 'impersonationNoLongerAllowed'
  | 'impersonationSessionEnded'
  | 'inviteLinkClaimUndone'
  | 'memberJoinedKept'
  | 'webhookTurnedOffFailing'
  | 'webhookTurnedOffGone'
  | 'webhookTurnedOffUnreadable';

/**
 * The more precise descriptions of `password_check_failed`, by what the
 * current password was typed for (`PasswordCheckPurpose` in
 * `src/server/auth/current-password.ts`).
 */
const PASSWORD_CHECK_DESCRIPTIONS = new Map<unknown, AuditEventDescription>([
  ['change_password', 'passwordCheckFailedChangePassword'],
  ['deactivate', 'passwordCheckFailedDeactivate'],
  ['enable_two_factor', 'passwordCheckFailedEnableTwoFactor'],
  ['disable_two_factor', 'passwordCheckFailedDisableTwoFactor'],
  ['generate_backup_codes', 'passwordCheckFailedBackupCodes'],
]);

/**
 * The more precise descriptions of `impersonation_ended`, by why it ended
 * (`ImpersonationEndReason` in `src/server/auth/impersonation.ts`); going
 * back to your own account (`stopped`) keeps the label.
 */
const IMPERSONATION_END_DESCRIPTIONS = new Map<unknown, AuditEventDescription>([
  ['expired', 'impersonationExpired'],
  ['no_longer_allowed', 'impersonationNoLongerAllowed'],
  ['session_ended', 'impersonationSessionEnded'],
]);

/**
 * The more precise descriptions of `webhook_turned_off` when Adiutor turned
 * the webhook off itself, by why (`WEBHOOK_OFF_REASONS` in
 * `src/lib/webhooks.ts`); a staff Admin turning it off (`manual`) keeps the label.
 */
const WEBHOOK_OFF_DESCRIPTIONS = new Map<unknown, AuditEventDescription>([
  ['failing', 'webhookTurnedOffFailing'],
  ['gone', 'webhookTurnedOffGone'],
  ['unreadable', 'webhookTurnedOffUnreadable'],
]);

/**
 * How an event is described: a key in the `audit` namespace, its label
 * (`actions.<action>`) or a more precise description (`events.<name>`).
 */
export type AuditEventMessageKey = `actions.${AuditAction}` | `events.${AuditEventDescription}`;

/**
 * Describes an event for the staff audit log: its label, or a more precise
 * one where the details change what happened (a sign-out that ended only
 * some sessions, a wrong code at sign-in rather than on the step-up page,
 * what a wrong current password was typed for, why a sign-in as a user
 * ended, an invite link that became usable again because its email couldn't
 * be sent, an invitation used by someone who was in already and kept their
 * role, a webhook Adiutor turned off itself). The caller translates the
 * key in the reader's language, `getTranslations('audit')`.
 *
 * @param action - What happened.
 * @param details - The event's details.
 * @returns The description's key in the `audit` namespace, e.g. `actions.sign_in`.
 */
export function describeAuditEvent(
  action: AuditAction,
  details: Record<string, unknown>,
): AuditEventMessageKey {
  if (action === 'sessions_revoked' && details.mfaRequired) {
    return 'events.sessionsRevokedMfaRequired';
  }
  if (action === 'sessions_revoked' && details.others) {
    return 'events.sessionsRevokedOthers';
  }
  // A wrong code at a password sign-in's code step, rather than on the step-up page.
  if (action === 'mfa_failed' && details.atSignIn === true) {
    return 'events.mfaFailedAtSignIn';
  }
  // Recorded by `checkCurrentPassword` and the reactions to Better Auth's two-step endpoints, with
  // what the password was asked for.
  const checkDescription =
    action === 'password_check_failed' ? PASSWORD_CHECK_DESCRIPTIONS.get(details.purpose) : null;
  if (checkDescription) {
    return `events.${checkDescription}`;
  }
  // Recorded with why it ended, unless the staff member went back to their own account.
  const endDescription =
    action === 'impersonation_ended' ? IMPERSONATION_END_DESCRIPTIONS.get(details.reason) : null;
  if (endDescription) {
    return `events.${endDescription}`;
  }
  // Recorded by `claimInviteLink` when the email of a claim couldn't be sent and it was undone.
  if (action === 'invite_link_claimed' && details.undone === true) {
    return 'events.inviteLinkClaimUndone';
  }
  // Adiutor turned a webhook off itself, with why.
  const offDescription =
    action === 'webhook_turned_off' ? WEBHOOK_OFF_DESCRIPTIONS.get(details.reason) : null;
  if (offDescription) {
    return `events.${offDescription}`;
  }
  // Someone who was in already used an invitation or invite link: nothing was given (`join`).
  if (action === 'member_joined' && details.kept === true) {
    return 'events.memberJoinedKept';
  }
  return `actions.${action}`;
}
