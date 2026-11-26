/**
 * @file What the invitation page (`/invite/[token]`) and the invite link page
 * (`/join/[token]`) show once their link is found: the heading, then one of
 * three steps. The pages load the link and the actor and pass the form.
 */
import type { ReactNode } from 'react';

import { mustSetUpMfa } from '@/lib/authz/mfa';
import type { ActorMfa } from '@/lib/authz/mfa';
import { mayUseInviteLinks } from '@/lib/authz/permissions';
import type { PlatformRole, Role } from '@/lib/authz/roles';

import InvitationHeading from './invitation-heading';
import InviteLinksNotAllowed from './invite-links-not-allowed';
import SetUpMfaFirst from './set-up-mfa-first';

/**
 * Props for {@link InvitationView}.
 */
interface InvitationViewProps {
  /** What the link offers: the company (or the staff's name), whether it's the staff, and the role. */
  preview: { companyName: string; target: 'staff' | 'company'; role: Role };
  /** The staff's name (`requestStaffName`), for the offer's sentence. */
  staffName: string;
  /** The signed-in user, or `null` for a visitor. */
  actor:
    | (Pick<ActorMfa, 'mfaRequired' | 'mfaEnabled' | 'canConfirmSessions'> & {
        platformRole: PlatformRole | null;
      })
    | null;
  /** Whether the invitation came from an invite link, which Finance and Support can't use. */
  linkBased: boolean;
  /** The form that accepts it, shown when neither refusal applies. */
  children: ReactNode;
}

/**
 * The heading and the step: Finance and Support can't use what an invite link
 * sent (`InviteLinksNotAllowed`); a role that needs MFA sets it up first
 * (`SetUpMfaFirst`); otherwise the form.
 */
export default function InvitationView({
  preview,
  staffName,
  actor,
  linkBased,
  children,
}: InvitationViewProps) {
  let step = children;
  if (actor && linkBased && !mayUseInviteLinks(actor.platformRole)) {
    step = <InviteLinksNotAllowed />;
  } else if (actor && mustSetUpMfa(actor)) {
    step = <SetUpMfaFirst />;
  }
  return (
    <div className="flex flex-col gap-8">
      <InvitationHeading
        companyName={preview.companyName}
        target={preview.target}
        staffName={staffName}
        roleId={preview.role}
      />
      {step}
    </div>
  );
}
