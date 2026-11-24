/**
 * @file The heading of the invitation and invite link pages: the company's
 * avatar, "Join <company>" and the role being offered.
 */
import { useTranslations } from 'next-intl';

import Avatar from '@/components/ui/avatar';
import type { Role } from '@/lib/authz/roles';

/**
 * Props for {@link InvitationHeading}.
 */
interface InvitationHeadingProps {
  /** The company the person is invited to (or the staff's name). */
  companyName: string;
  /** The role they'd get, named in the reader's language (`roles.<role>.label`). */
  roleId: Role;
}

/**
 * The company's avatar, the page's `h1` and what the invitation offers.
 */
export default function InvitationHeading({ companyName, roleId }: InvitationHeadingProps) {
  const t = useTranslations('auth');
  const tRoles = useTranslations('roles');
  return (
    <div className="flex flex-col gap-3">
      <Avatar name={companyName} size="lg" brand />
      <h1 className="text-2xl font-semibold text-foreground">
        {t('invitation.heading', { company: companyName })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t('invitation.offer', { company: companyName, role: tRoles(`${roleId}.label`) })}
      </p>
    </div>
  );
}
