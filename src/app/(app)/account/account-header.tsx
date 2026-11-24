/**
 * @file Heading and tabs shown at the top of the account pages, rendered by
 * the account layout (`layout.tsx`), so they stay while the tabs change.
 */
import { useTranslations } from 'next-intl';

import Avatar from '@/components/ui/avatar';
import PageHeader from '@/components/ui/page-header';
import SegmentTabNav from '@/components/ui/segment-tab-nav';
import displayName from '@/lib/display-name';

/**
 * Props for {@link AccountHeader}.
 */
interface AccountHeaderProps {
  /** The signed-in user's name (may be empty). */
  name: string;
  /** Their email address. */
  email: string;
  /** Their picture's address, or `null` (or left out) for their initials. */
  picture?: string | null;
}

/**
 * The "Account" heading with the user's avatar, and tabs for Profile,
 * Preferences, Security and Activity, the current one (from the URL) marked
 * `aria-current="page"`.
 *
 * @returns The header.
 */
export default function AccountHeader({ name, email, picture = null }: AccountHeaderProps) {
  const t = useTranslations('account');
  return (
    <PageHeader
      title={t('header.title')}
      description={t('header.description')}
      leading={<Avatar name={displayName({ name, email })} size="lg" src={picture} />}
    >
      <SegmentTabNav
        label={t('header.sections')}
        items={[
          { href: '/account', label: t('header.profile'), segment: null },
          {
            href: '/account/preferences',
            label: t('header.preferences'),
            segment: 'preferences',
          },
          { href: '/account/security', label: t('header.security'), segment: 'security' },
          { href: '/account/activity', label: t('header.activity'), segment: 'activity' },
        ]}
      />
    </PageHeader>
  );
}
