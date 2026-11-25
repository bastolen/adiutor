/**
 * @file Shown instead of the Accept or Join button when the signed-in user's
 * role requires MFA they haven't set up yet (e.g. they're Admin of another
 * company): accepting would only send them to set it up and lose the step.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';

/**
 * Explains that MFA comes first, with a way to set it up.
 */
export default function SetUpMfaFirst() {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">{t('invitation.mfaFirst')}</Alert>
      <Button fullWidth asChild>
        <Link href="/account/security">{t('invitation.setUpMfa')}</Link>
      </Button>
    </div>
  );
}
