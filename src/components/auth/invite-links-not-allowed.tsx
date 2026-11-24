/**
 * @file Shown instead of the Join or Accept button when a Finance or Support
 * staff member opens an invite link, or an invitation that came from one
 * (see `mayUseInviteLinks` in `src/lib/authz/permissions.ts`).
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';

/**
 * Explains that the signed-in account can't use invite links, with a way back
 * to the dashboard.
 */
export default function InviteLinksNotAllowed() {
  const t = useTranslations('errors');
  const tCommon = useTranslations('common');
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">{t('inviteLinks.notAllowed')}</Alert>
      <Button variant="secondary" fullWidth asChild>
        <Link href="/dashboard">{tCommon('actions.goToDashboard')}</Link>
      </Button>
    </div>
  );
}
