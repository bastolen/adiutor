/**
 * @file Message for an invitation, invite link or sign-in link that can't be
 * used.
 */
import { LinkIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import IconTile from '@/components/ui/icon-tile';

/**
 * Explains that the link doesn't work, without saying why (expired, used,
 * revoked or never valid all look the same).
 *
 * @param props - Component props.
 * @param props.description - What may have happened and what to do (by
 *   default, for invitations: "It may have expired, been used already or been
 *   revoked. …").
 * @param props.href - Where "Go to sign in" goes (by default, the sign-in page).
 */
export default function UnusableLink({
  description = null,
  href = '/auth',
}: {
  description?: string | null;
  href?: string;
}) {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col gap-6">
      <IconTile icon={LinkIcon} size="lg" />
      <AuthHeading
        title={t('unusableLink.heading')}
        description={description ?? t('unusableLink.invitation')}
      />
      <Button variant="secondary" fullWidth asChild>
        <Link href={href}>{t('actions.goToSignIn')}</Link>
      </Button>
    </div>
  );
}
