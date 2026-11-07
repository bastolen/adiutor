/**
 * @file Shown instead of the Join or Accept button when a Finance or Support
 * staff member opens an invite link, or an invitation that came from one
 * (see `mayUseInviteLinks` in `src/lib/authz/permissions.ts`).
 */
import Link from 'next/link';

import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import { INVITE_LINKS_NOT_ALLOWED } from '@/lib/authz/permissions';

/**
 * Explains that the signed-in account can't use invite links, with a way back
 * to the dashboard.
 *
 * @returns The explanation.
 */
export default function InviteLinksNotAllowed() {
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">{INVITE_LINKS_NOT_ALLOWED}</Alert>
      <Button variant="secondary" fullWidth asChild>
        <Link href="/dashboard">Go to your dashboard</Link>
      </Button>
    </div>
  );
}
