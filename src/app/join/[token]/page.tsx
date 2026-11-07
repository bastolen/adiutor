/**
 * @file Invite link page, served at `/join/[token]` (public). Finance and Support
 * staff see why they can't use it instead of the Join button.
 */
import { Suspense } from 'react';

import InvitationHeading from '@/components/auth/invitation-heading';
import InviteLinksNotAllowed from '@/components/auth/invite-links-not-allowed';
import SetUpMfaFirst from '@/components/auth/set-up-mfa-first';
import UnusableLink from '@/components/auth/unusable-link';
import { FormSkeleton } from '@/components/ui/skeleton';
import { mustSetUpMfa } from '@/lib/authz/mfa';
import { mayUseInviteLinks } from '@/lib/authz/permissions';
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

  // Finance and Support can't use invite links; a role that needs MFA sets it up first.
  let step = <JoinForm token={token} signedInEmail={actor?.email ?? null} />;
  if (actor && !mayUseInviteLinks(actor.platformRole)) {
    step = <InviteLinksNotAllowed />;
  } else if (actor && mustSetUpMfa(actor)) {
    step = <SetUpMfaFirst />;
  }

  return (
    <div className="flex flex-col gap-8">
      <InvitationHeading companyName={preview.companyName} roleLabel={preview.roleLabel} />
      {step}
    </div>
  );
}

/**
 * The invite link page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @returns The page.
 */
export default function JoinPage({ params }: PageProps<'/join/[token]'>) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <Join params={params} />
    </Suspense>
  );
}
