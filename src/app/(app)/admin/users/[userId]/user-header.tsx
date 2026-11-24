/**
 * @file Heading and tabs of a user's page, rendered by its layout
 * (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import Avatar from '@/components/ui/avatar';
import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';
import displayName from '@/lib/display-name';
import type { UserDetail } from '@/server/people/user-admin';

import { AccountStateBadges, StaffBadge } from '../user-badges';
import { USER_TAB_SEGMENTS, type UserTab } from './user-access';

/** Props for {@link UserHeader}. */
interface UserHeaderProps {
  /** The user. */
  user: Pick<
    UserDetail,
    'id' | 'name' | 'email' | 'picture' | 'staffRole' | 'deactivatedAt' | 'emailVerified'
  >;
  /** The tabs the viewer gets (`userPageAccess`), in order. */
  tabs: readonly UserTab[];
}

/**
 * The user's name (the page's `h1`), their address, avatar and badges, a link
 * back to the users, and the tabs the viewer gets: a navigation landmark,
 * with the current one (from the URL) marked `aria-current="page"`. Its text
 * comes from `admin.user`.
 *
 * @returns The header.
 */
export default function UserHeader({ user, tabs }: UserHeaderProps) {
  const t = useTranslations('admin.user');
  const userName = displayName(user);
  const base = `/admin/users/${user.id}`;
  return (
    <PageHeader
      back={{ href: '/admin/users', label: t('back') }}
      leading={
        <Avatar name={userName} size="lg" brand={user.staffRole !== null} src={user.picture} />
      }
      title={userName}
      description={user.email}
    >
      <div className="flex flex-wrap items-center gap-2">
        {user.staffRole && <StaffBadge role={user.staffRole} />}
        <AccountStateBadges
          deactivated={user.deactivatedAt !== null}
          emailVerified={user.emailVerified}
        />
      </div>
      <SegmentTabNav
        label={t('tabs.label')}
        items={tabs.map((tab) => {
          const segment = USER_TAB_SEGMENTS[tab];
          return {
            href: segment ? `${base}/${segment}` : base,
            label: t(`tabs.${tab}`),
            segment,
          };
        })}
      />
    </PageHeader>
  );
}
