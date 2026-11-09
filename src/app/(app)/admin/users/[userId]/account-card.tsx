/**
 * @file The "Account" card on the user detail page: the user's email address
 * and whether it's verified, whether the account is active, when they were
 * last active and when the account was created.
 */
import { useLocale } from 'next-intl';

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
  return (
    <Card title="Account">
      <dl className="divide-y divide-border">
        <DetailRow term="Email">
          {email}
          {emailVerified ? (
            <Badge tone="success">Verified</Badge>
          ) : (
            <Badge tone="warning">Not verified</Badge>
          )}
        </DetailRow>
        <DetailRow term="Status">
          {deactivatedAt ? <Badge tone="danger">Deactivated</Badge> : 'Active'}
        </DetailRow>
        <DetailRow term="Last active">
          <RelativeTime date={lastActiveAt} />
        </DetailRow>
        <DetailRow term="Account created">{formatDate(createdAt, locale)}</DetailRow>
      </dl>
    </Card>
  );
}
