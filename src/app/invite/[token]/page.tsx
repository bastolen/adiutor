/**
 * @file Invitation page, served at `/invite/[token]` (public). Opened from an
 * invitation email. Finance and Support staff can't accept an invitation that
 * came from an invite link, and see why instead.
 */
import { Suspense } from 'react';

import InvitationView from '@/components/auth/invitation-view';
import UnusableLink from '@/components/auth/unusable-link';
import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { getOptionalActor } from '@/server/authz';
import { requestStaffName } from '@/server/branding';
import { getInvitationPreview } from '@/server/people/invitations';

import AcceptInvitation from './accept-invitation';

/**
 * Loads the invitation and shows how to accept it. Doesn't show the invited
 * email address.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 */
async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, actor, staffName] = await Promise.all([
    getInvitationPreview(appContext, token),
    getOptionalActor(),
    requestStaffName(),
  ]);
  if (!preview) {
    return <UnusableLink />;
  }

  return (
    <InvitationView
      preview={preview}
      staffName={staffName}
      actor={actor}
      linkBased={preview.fromInviteLink}
    >
      <AcceptInvitation token={token} signedInEmail={actor?.email ?? null} />
    </InvitationView>
  );
}

/**
 * The invitation page. Its forms' text comes with it (`auth`).
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
