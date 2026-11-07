/**
 * @file Heading and tabs shown at the top of the account pages, rendered by
 * the account layout (`layout.tsx`), so they stay while the tabs change.
 */
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
}

/**
 * The "Account" heading with the user's avatar, and tabs for Profile and
 * Security, the current one (from the URL) marked `aria-current="page"`.
 *
 * @param props - Header props.
 * @param props.name - The user's name.
 * @param props.email - Their email address.
 * @returns The header.
 */
export default function AccountHeader({ name, email }: AccountHeaderProps) {
  return (
    <PageHeader
      title="Account"
      description="Your profile, sign-in methods and security."
      leading={<Avatar name={displayName({ name, email })} size="lg" />}
    >
      <SegmentTabNav
        label="Account sections"
        items={[
          { href: '/account', label: 'Profile', segment: null },
          { href: '/account/security', label: 'Security', segment: 'security' },
        ]}
      />
    </PageHeader>
  );
}
