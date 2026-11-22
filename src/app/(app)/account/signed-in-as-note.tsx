/**
 * @file The note at the top of the account pages while a staff
 * member is signed in as the user: they see the pages as the user does, but
 * read-only (the controls are off, `useSignedInAs`), and without the personal
 * details they don't see on the user's page (`personalDataShown`). On the
 * Security page it also says when the user must set up MFA first, since
 * that's the page they'd see now. See
 * docs/decisions/0017-staff-sign-in-as-users.md.
 */
import { getTranslations } from 'next-intl/server';

import Alert from '@/components/ui/alert';
import type { PersonalDataShown } from '@/lib/authz/impersonation';
import { mustSetUpMfa } from '@/lib/authz/mfa';
import displayName from '@/lib/display-name';
import type { Actor } from '@/server/actor';

import { userLink } from '../_people/rich-tags';

/**
 * Says the pages are the user's, read-only; which details are left out, if
 * any, with a link to the user's page; and, on the Security page, when the
 * user must set up MFA first.
 *
 * @param props - Component props.
 * @param props.actor - The user, as the staff member is signed in as them.
 * @param props.shown - Which personal details the pages show.
 * @param props.onSecurityPage - Whether it's the Security page, where users who must set up MFA
 *   are sent.
 * @returns The note.
 */
export default async function SignedInAsNote({
  actor,
  shown,
  onSecurityPage = false,
}: {
  actor: Actor;
  shown: PersonalDataShown;
  onSecurityPage?: boolean;
}) {
  const t = await getTranslations('account.signedInAs');
  const name = displayName(actor);
  const leftOut = !shown.devices || !shown.accountNames || !shown.origins;
  return (
    <Alert tone="info">
      <span className="flex flex-col gap-2">
        <span>{t('note', { name })}</span>
        {leftOut && <span>{t.rich('leftOut', { link: userLink(actor.id) })}</span>}
        {onSecurityPage && mustSetUpMfa(actor) && <span>{t('mustSetUpMfa', { name })}</span>}
      </span>
    </Alert>
  );
}
