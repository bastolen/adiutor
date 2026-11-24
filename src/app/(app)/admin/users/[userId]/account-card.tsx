/**
 * @file The "Account" card on the Overview tab of a user's page: the user's email address
 * and whether it's verified, whether the account is active, when they were
 * last active and when the account was created. Text from `admin.user.account`.
 */
import { useLocale, useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import { DescriptionList, DescriptionRow } from '@/components/ui/description-list';
import RelativeTime from '@/components/ui/relative-time';
import formatDate from '@/lib/format';
import useReaderTimeZone from '@/lib/i18n/use-reader-time-zone';
import type { UserDetail } from '@/server/people/user-admin';

/**
 * Props for {@link AccountCard}: the parts of the user it shows.
 */
type AccountCardProps = Pick<
  UserDetail,
  'email' | 'emailVerified' | 'deactivatedAt' | 'lastActiveAt' | 'createdAt'
>;

/**
 * The user's account details.
 */
export default function AccountCard({
  email,
  emailVerified,
  deactivatedAt,
  lastActiveAt,
  createdAt,
}: AccountCardProps) {
  const locale = useLocale();
  const timeZone = useReaderTimeZone();
  const t = useTranslations('admin.user.account');
  return (
    <Card title={t('title')}>
      <DescriptionList>
        <DescriptionRow term={t('email')}>
          {email}
          {emailVerified ? (
            <Badge tone="success">{t('verified')}</Badge>
          ) : (
            <Badge tone="warning">{t('notVerified')}</Badge>
          )}
        </DescriptionRow>
        <DescriptionRow term={t('status')}>
          {deactivatedAt ? <Badge tone="danger">{t('deactivated')}</Badge> : t('active')}
        </DescriptionRow>
        <DescriptionRow term={t('lastActive')}>
          <RelativeTime date={lastActiveAt} />
        </DescriptionRow>
        <DescriptionRow term={t('created')}>
          {formatDate(createdAt, locale, timeZone)}
        </DescriptionRow>
      </DescriptionList>
    </Card>
  );
}
