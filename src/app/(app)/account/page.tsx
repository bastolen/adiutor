/**
 * @file The Profile page of the account, served at `/account`: name, email
 * (with verification), a summary of sign-in security and recent activity on
 * the account (sign-ins and changes, from the audit log). Password, passkeys,
 * two-step verification and connected accounts are on the Security page. The
 * verification link comes back to the Email card (`#email`), which says
 * whether it worked.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import ActivityList from '@/components/ui/activity-list';
import Alert from '@/components/ui/alert';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import appContext from '@/server/app-context';
import { listOwnActivity } from '@/server/audit';
import { getActor } from '@/server/authz';

import accountMessage, { type AccountParams, EMAIL_SECTION } from './account-messages';
import { sendVerificationAction } from './actions';
import NameForm from './name-form';
import describeOwnActivity from './own-activity';

/**
 * Page metadata.
 */
export const metadata: Metadata = {
  title: 'Account · Adiutor',
};

/**
 * Loads the user and shows their settings.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters; set after verifying the email.
 * @returns The page content.
 */
async function AccountSettings({ searchParams }: { searchParams: Promise<AccountParams> }) {
  const actor = await getActor({ allowMissingMfa: true });
  const [params, activity] = await Promise.all([searchParams, listOwnActivity(appContext, actor)]);
  const message = accountMessage(params);

  return (
    <>
      <Card
        title="Sign-in security"
        description={
          actor.mfaEnabled
            ? 'Protected with MFA: a passkey, two-step verification or a connected account with two-factor authentication. Your password and connected accounts are on the Security page too.'
            : "Add a passkey or two-step verification so a stolen password isn't enough to get in. Your password and connected accounts are on the Security page."
        }
        actions={
          <Button asChild variant={actor.mfaEnabled ? 'secondary' : 'primary'} size="sm">
            <Link href="/account/security">{actor.mfaEnabled ? 'Manage' : 'Set up'}</Link>
          </Button>
        }
      >
        {actor.mfaEnabled ? (
          <Badge tone="success">Protected</Badge>
        ) : (
          <Badge tone="warning">Password only</Badge>
        )}
      </Card>
      <Card
        // The verification link comes back here, saying whether it worked.
        id={EMAIL_SECTION}
        title="Email"
        description={
          actor.emailVerified
            ? 'The address you sign in with and get emails on.'
            : 'The address you sign in with and get emails on. Verify it, so we know it reaches you.'
        }
        footer={
          actor.emailVerified ? undefined : (
            <RowAction action={sendVerificationAction} label="Send verification email" />
          )
        }
      >
        <div className="flex flex-col gap-4">
          {message && (
            <Alert tone={message.tone} focusOnShow>
              {message.text}
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium break-all">{actor.email}</span>
            {actor.emailVerified ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Badge tone="warning">Not verified</Badge>
            )}
          </div>
        </div>
      </Card>
      <Card title="Name" description="How you're shown to others in Adiutor.">
        <NameForm name={actor.name} />
      </Card>
      <Card
        title="Recent activity"
        description={
          activity.length === 0
            ? 'Sign-ins and changes to your account will show up here.'
            : "Sign-ins and changes to your account, newest first. Don't recognise something? Change your password and sign out your other devices."
        }
        actions={
          activity.length > 0 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/account/security">Review security</Link>
            </Button>
          ) : undefined
        }
      >
        {activity.length > 0 && (
          <ActivityList
            label="Your recent activity"
            items={activity.map((event) => ({
              id: event.id,
              at: event.at,
              userAgent: event.userAgent,
              ip: event.ip,
              description: describeOwnActivity(event, actor.id),
            }))}
          />
        )}
      </Card>
    </>
  );
}

/**
 * The Profile page of the account.
 *
 * @param props - Page props from Next.js.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function AccountPage({ searchParams }: PageProps<'/account'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <AccountSettings searchParams={searchParams} />
    </Suspense>
  );
}
