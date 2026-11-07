/**
 * @file Badges for a user's account state, shared by the users list and the
 * user detail page: MFA status, deactivated and unverified email.
 */
import Badge, { type BadgeTone } from '@/components/ui/badge';
import type { MfaStatus } from '@/lib/authz/mfa';

/** Label and tone per MFA status. */
const MFA_BADGES: Record<MfaStatus, { label: string; tone: BadgeTone }> = {
  protected: { label: 'MFA on', tone: 'success' },
  optional: { label: 'No MFA', tone: 'neutral' },
  required: { label: 'Needs MFA', tone: 'warning' },
};

/**
 * Shows how an account stands with MFA.
 *
 * @param props - Component props.
 * @param props.status - The MFA status.
 * @returns The badge.
 */
export function MfaBadge({ status }: { status: MfaStatus }) {
  const { label, tone } = MFA_BADGES[status];
  return <Badge tone={tone}>{label}</Badge>;
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
  return (
    <>
      {deactivated && <Badge tone="danger">Deactivated</Badge>}
      {!emailVerified && <Badge tone="warning">Email not verified</Badge>}
    </>
  );
}
