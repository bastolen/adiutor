/**
 * @file The "Account" card on the user detail page: the user's email address
 * and whether it's verified, whether the account is active, when they were
 * last active and when the account was created. Text from `admin.user.account`.
 */
import { useLocale, useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import RelativeTime from '@/components/ui/relative-time';
import formatDate from '@/lib/format';
import type { UserDetail } from '@/server/people/user-admin';

import DetailRow from './detail-row';

/**
 * Props for {@link AccountCard}: the parts of the user it shows.
 */
type AccountCardProps = Pick<
  UserDetail,
  'email' | 'emailVerified' | 'deactivatedAt' | 'lastActiveAt' | 'createdAt'
>;

/**
 * The user's account details.
 *
 * @param props - Component props.
 * @param props.email - Their email address.
 * @param props.emailVerified - Whether they verified it.
 * @param props.deactivatedAt - When the account was deactivated, if it is.
 * @param props.lastActiveAt - When they were last active, if ever.
 * @param props.createdAt - When the account was created.
 * @returns The card.
 */
export default function AccountCard({
  email,
  emailVerified,
  deactivatedAt,
  lastActiveAt,
  createdAt,
}: AccountCardProps) {
  const locale = useLocale();
  const t = useTranslations('admin.user.account');
  return (
    <Card title={t('title')}>
      <dl className="divide-y divide-border">
        <DetailRow term={t('email')}>
          {email}
          {emailVerified ? (
            <Badge tone="success">{t('verified')}</Badge>
          ) : (
            <Badge tone="warning">{t('notVerified')}</Badge>
          )}
        </DetailRow>
        <DetailRow term={t('status')}>
          {deactivatedAt ? <Badge tone="danger">{t('deactivated')}</Badge> : t('active')}
        </DetailRow>
        <DetailRow term={t('lastActive')}>
          <RelativeTime date={lastActiveAt} />
        </DetailRow>
        <DetailRow term={t('created')}>{formatDate(createdAt, locale)}</DetailRow>
      </dl>
    </Card>
  );
}
