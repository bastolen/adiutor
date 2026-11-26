/**
 * @file The heading of the invitation and invite link pages: the company's
 * avatar, "Join <company>" and the role being offered, which names the staff
 * too ("… to join <company> on <staff> …"), but only once when the
 * invitation is to the staff themselves.
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
  /** Whether the invitation is to the staff (`companyName` is then the staff's name) or a company. */
  target: 'staff' | 'company';
  /** The staff's name (`requestStaffName`), which every page shows instead of "Adiutor". */
  staffName: string;
  /** The role they'd get, named in the reader's language (`roles.<role>.label`). */
  roleId: Role;
}

/**
 * The company's avatar, the page's `h1` and what the invitation offers.
 */
export default function InvitationHeading({
  companyName,
  target,
  staffName,
  roleId,
}: InvitationHeadingProps) {
  const t = useTranslations('auth');
  const tRoles = useTranslations('roles');
  return (
    <div className="flex flex-col gap-3">
      <Avatar name={companyName} size="lg" brand />
      <h1 className="text-2xl font-semibold text-foreground">
        {t('invitation.heading', { company: companyName })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t('invitation.offer', {
          target,
          company: companyName,
          staff: staffName,
          role: tRoles(`${roleId}.label`),
        })}
      </p>
    </div>
  );
}
