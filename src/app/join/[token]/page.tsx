/**
 * @file Invite link page, served at `/join/[token]` (public). Finance and Support
 * staff see why they can't use it instead of the Join button.
 */
import { Suspense } from 'react';

import InvitationView from '@/components/auth/invitation-view';
import UnusableLink from '@/components/auth/unusable-link';
import { FormSkeleton } from '@/components/ui/skeleton';
import ClientMessages from '@/lib/i18n/client-messages';
import appContext from '@/server/app-context';
import { getOptionalActor } from '@/server/authz';
import { getInviteLinkPreview } from '@/server/people/invite-links';

import JoinForm from './join-form';

/**
 * Loads the link and shows how to use it.
 *
 * @param props - Component props.
 * @param props.params - Route parameters.
 * @returns The page content.
 */
async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, actor] = await Promise.all([
    getInviteLinkPreview(appContext, token),
    getOptionalActor(),
  ]);
  if (!preview) {
    return <UnusableLink />;
  }

  return (
    <InvitationView preview={preview} actor={actor} linkBased>
      <JoinForm token={token} signedInEmail={actor?.email ?? null} />
    </InvitationView>
  );
}

/**
 * The invite link page. Its form's text comes with it (`auth`).
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @returns The page.
 */
export default function JoinPage({ params }: PageProps<'/join/[token]'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <ClientMessages namespaces={['auth']}>
        <Join params={params} />
      </ClientMessages>
    </Suspense>
  );
}
