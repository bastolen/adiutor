/**
 * @file Invitation page, served at `/invite/[token]` (public). Opened from an
 * invitation email. Finance and Support staff can't accept an invitation that
 * came from an invite link, and see why instead.
 */
import { Suspense } from 'react';

import InvitationHeading from '@/components/auth/invitation-heading';
import InviteLinksNotAllowed from '@/components/auth/invite-links-not-allowed';
import SetUpMfaFirst from '@/components/auth/set-up-mfa-first';
import UnusableLink from '@/components/auth/unusable-link';
import { FormSkeleton } from '@/components/ui/skeleton';
import { mustSetUpMfa } from '@/lib/authz/mfa';
import { mayUseInviteLinks } from '@/lib/authz/permissions';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { getOptionalActor } from '@/server/authz';
import { getInvitationPreview } from '@/server/people/invitations';

import AcceptInvitation from './accept-invitation';

/**
 * Loads the invitation and shows how to accept it. Doesn't show the invited
 * email address.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @returns The page content.
 */
async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, actor] = await Promise.all([
    getInvitationPreview(appContext, token),
    getOptionalActor(),
  ]);
  if (!preview) {
    return <UnusableLink />;
  }

  // Finance and Support can't accept what an invite link sent; a role that needs MFA sets it up first.
  let step = <AcceptInvitation token={token} signedInEmail={actor?.email ?? null} />;
  if (actor && preview.fromInviteLink && !mayUseInviteLinks(actor.platformRole)) {
    step = <InviteLinksNotAllowed />;
  } else if (actor && mustSetUpMfa(actor)) {
    step = <SetUpMfaFirst />;
  }

  return (
    <div className="flex flex-col gap-8">
      <InvitationHeading companyName={preview.companyName} roleId={preview.role} />
      {step}
    </div>
  );
}

/**
 * The invitation page. Its forms' text comes with it (`auth`).
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @returns The page.
 */
export default function InvitationPage({ params }: PageProps<'/invite/[token]'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <Invitation params={params} />
      </ClientMessages>
    </Suspense>
  );
}
