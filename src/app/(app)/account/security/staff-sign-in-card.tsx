/**
 * @file The "Sign-ins by staff" card on the Security page: whether staff may
 * sign in as the user ("Sign in as", see
 * docs/decisions/0017-staff-sign-in-as-users.md), and a button to turn it off
 * or back on. The security email after a staff member signed in as the user
 * links here (`#staff-sign-in`). Text from `account.security.staffSignIn`.
 */
import { useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { IMPERSONATION_MINUTES } from '@/lib/authz/impersonation';

import { staffSignInAction } from './actions';

/**
 * Says what signing in as the user means for them and whether it's on, with
 * the button that switches it (the action's message is the toast).
 *
 * @param props - Component props.
 * @param props.allowed - Whether staff may sign in as the user now.
 * @returns The card.
 */
export default function StaffSignInCard({ allowed }: { allowed: boolean }) {
  const t = useTranslations('account.security.staffSignIn');
  return (
    <Card
      id="staff-sign-in"
      title={t('title')}
      description={t('description', { minutes: IMPERSONATION_MINUTES })}
      actions={allowed ? <Badge tone="success">{t('on')}</Badge> : <Badge>{t('off')}</Badge>}
    >
      <div className="flex justify-end">
        <RowAction
          action={staffSignInAction}
          fields={{ allowed: allowed ? 'false' : 'true' }}
          label={allowed ? t('turnOff') : t('turnOn')}
        />
      </div>
    </Card>
  );
}
