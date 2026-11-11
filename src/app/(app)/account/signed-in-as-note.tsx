/**
 * @file What the Profile and Security pages show while a staff member is
 * signed in as the user: a note instead of the user's own account settings,
 * which hold personal data (their devices, IP addresses and provider accounts)
 * and changes nobody makes in their name. Staff find the user's account and
 * sign-in security on the user's page. See
 * docs/decisions/0017-staff-sign-in-as-users.md.
 */
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import Alert from '@/components/ui/alert';
import TextLink from '@/components/ui/text-link';
import { mustSetUpMfa } from '@/lib/authz/mfa';
import displayName from '@/lib/display-name';
import type { Actor } from '@/server/actor';

/**
 * Makes the `<link>` tag of the note a link to the user's page.
 *
 * @param userId - The user's ID.
 * @returns The renderer `t.rich` takes for the tag.
 */
function userLink(userId: string) {
  return function UserLink(chunks: ReactNode) {
    return <TextLink href={`/admin/users/${userId}`}>{chunks}</TextLink>;
  };
}

/**
 * Says the user's account pages aren't shown while signed in as them, with a
 * link to their user page, and, on the Security page, when the user must set
 * up MFA first (that's the page they'd see now).
 *
 * @param props - Component props.
 * @param props.actor - The user, as the staff member is signed in as them.
 * @param props.onSecurityPage - Whether it's the Security page, where users who must set up MFA
 *   are sent.
 * @returns The note.
 */
export default async function SignedInAsNote({
  actor,
  onSecurityPage = false,
}: {
  actor: Actor;
  onSecurityPage?: boolean;
}) {
  const t = await getTranslations('account.signedInAs');
  const name = displayName(actor);
  return (
    <>
      <Alert tone="info">{t.rich('note', { name, link: userLink(actor.id) })}</Alert>
      {onSecurityPage && mustSetUpMfa(actor) && (
        <Alert tone="info">{t('mustSetUpMfa', { name })}</Alert>
      )}
    </>
  );
}
