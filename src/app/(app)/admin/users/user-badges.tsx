/**
 * @file Badges for a user's account state, shared by the users list and the
 * user detail page: MFA status, staff role, deactivated and unverified
 * email. Their text comes from the `admin.users.badges` messages.
 */
import { useTranslations } from 'next-intl';

import Badge, { type BadgeTone } from '@/components/ui/badge';
import type { MfaStatus } from '@/lib/authz/mfa';
import type { PlatformRole } from '@/lib/authz/roles';

/** Tone per MFA status. */
const MFA_TONES: Record<MfaStatus, BadgeTone> = {
  protected: 'success',
  optional: 'neutral',
  required: 'warning',
};

/**
 * Shows how an account stands with MFA.
 *
 * @param props - Component props.
 * @param props.status - The MFA status.
 */
export function MfaBadge({ status }: { status: MfaStatus }) {
  const t = useTranslations('admin.users.badges');
  return <Badge tone={MFA_TONES[status]}>{t('mfa', { status })}</Badge>;
}

/**
 * Shows that a user is staff, with their staff role ("Staff · Admin").
 *
 * @param props - Component props.
 * @param props.role - Their staff role.
 */
export function StaffBadge({ role }: { role: PlatformRole }) {
  const t = useTranslations('admin.users.badges');
  const tRoles = useTranslations('roles');
  return <Badge tone="brand">{t('staff', { role: tRoles(`${role}.label`) })}</Badge>;
}

/**
 * Shows that an account is deactivated or its email isn't verified, if so.
 *
 * @param props - Component props.
 * @param props.deactivated - Whether the account is deactivated.
 * @param props.emailVerified - Whether the email address is verified.
 * @returns The badges, or nothing.
 */
export function AccountStateBadges({
  deactivated,
  emailVerified,
}: {
  deactivated: boolean;
  emailVerified: boolean;
}) {
  const t = useTranslations('admin.users.badges');
  return (
    <>
      {deactivated && <Badge tone="danger">{t('deactivated')}</Badge>}
      {!emailVerified && <Badge tone="warning">{t('emailNotVerified')}</Badge>}
    </>
  );
}
