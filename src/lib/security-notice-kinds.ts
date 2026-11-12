/**
 * @file The changes users get a security email about (`src/emails/security-notice.tsx`),
 * in a module of their own: the queued security notice's payload schema uses
 * them, and must not load the email template (and React) with it.
 */

/** The changes users are told about. */
export const SECURITY_NOTICE_KINDS = [
  'password_changed',
  'password_added',
  'password_reset',
  'two_factor_enabled',
  'two_factor_disabled',
  'backup_codes_regenerated',
  'passkey_added',
  'passkey_removed',
  'provider_connected',
  'provider_disconnected',
  'mfa_reset',
  'signed_out_everywhere',
  'account_deactivated',
  'account_reactivated',
  'staff_role_granted',
  'staff_role_changed',
  'staff_role_removed',
  'password_sign_in_paused',
  'company_role_changed',
  'removed_from_company',
  'account_deleted',
  'two_factor_locked',
  'impersonation_started',
] as const;

/**
 * One of {@link SECURITY_NOTICE_KINDS}. Each has its subject, heading and
 * text in `emails.securityNotice.<kind>`; the footer and the advice for when
 * it wasn't them are `select`s on the kind (`reason`, `ifNotYou`).
 */
export type SecurityNoticeKind = (typeof SECURITY_NOTICE_KINDS)[number];
