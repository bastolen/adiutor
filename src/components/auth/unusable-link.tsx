/**
 * @file Message for an invitation, invite link or sign-in link that can't be
 * used.
 */
import { LinkIcon } from 'lucide-react';
import Link from 'next/link';

import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';

/** What invitation and invite link pages say. */
const INVITATION_DESCRIPTION =
  'It may have expired, been used already or been revoked. Ask whoever invited you for a new one.';

/**
 * Explains that the link doesn't work, without saying why (expired, used,
 * revoked or never valid all look the same).
 *
 * @param props - Component props.
 * @param props.description - What may have happened and what to do (by default, for invitations).
 * @param props.href - Where "Go to sign in" goes (by default, the sign-in page).
 * @returns The message.
 */
export default function UnusableLink({
  description = INVITATION_DESCRIPTION,
  href = '/auth',
}: {
  description?: string;
  href?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <LinkIcon aria-hidden="true" className="size-5" />
      </span>
      <AuthHeading title="This link can't be used" description={description} />
      <Button variant="secondary" fullWidth asChild>
        <Link href={href}>Go to sign in</Link>
      </Button>
    </div>
  );
}
