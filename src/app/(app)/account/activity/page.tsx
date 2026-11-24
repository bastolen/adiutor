/**
 * @file The Activity tab of the account, served at `/account/activity`: the
 * devices the user is signed in on (sortable and paginated, each one or all
 * the others can be signed out) and the recent activity on the account
 * (sign-ins and changes, from the audit log). A staff member signed in as the
 * user sees it read-only, with a note, the devices only when they're a staff
 * Admin, and the activity's IP addresses and browsers only when they see the
 * audit log (`personalDataShown`, which the services apply: `listOwnSessions`
 * and `listOwnActivity`).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import ActivityList from '@/components/ui/activity-list';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton';
import { personalDataShown } from '@/lib/authz/impersonation';
import type { SearchParams } from '@/lib/search-params';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState } from '@/lib/tables/table-state';
import { DEVICES_TABLE } from '@/lib/tables/tables';
import appContext from '@/server/app-context';
import { listOwnActivity } from '@/server/audit';
import { getActor } from '@/server/authz';
import { listOwnSessions } from '@/server/people/user-admin';

import SignedInAsNote from '../signed-in-as-note';
import describeOwnActivity from './own-activity';
import SessionsCard from './sessions-card';

/**
 * Page metadata: "Activity · Account", in the request's language.
 *
 * @returns The metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('activity.title') };
}

/**
 * Loads the user's devices and recent activity and shows them.
 *
 * @param props - Component props.
 * @param props.searchParams - Query parameters: the devices table's sort and page (`DEVICES_TABLE`).
 * @returns The page content.
 */
async function Activity({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getActor({ allowMissingMfa: true });
  const [params, t, tAudit, tRoles] = await Promise.all([
    searchParams,
    getTranslations('account'),
    getTranslations('audit'),
    getTranslations('roles'),
  ]);
  const devicesRequested = parseTableState(DEVICES_TABLE, params);
  // A staff member signed in as the user gets only the personal details they see on the user's
  // page: the services leave the rest out.
  const [sessions, activity] = await Promise.all([
    listOwnSessions(appContext, actor, devicesRequested),
    listOwnActivity(appContext, actor),
  ]);
  const url = createPageUrl('/account/activity', {}, await getTranslations('tables'));

  return (
    <>
      {actor.signedInAs && <SignedInAsNote actor={actor} shown={personalDataShown(actor)} />}
      {sessions && (
        <SessionsCard
          sessions={sessions}
          table={url.table(DEVICES_TABLE, { ...devicesRequested, page: sessions.page })}
          currentSessionId={actor.sessionId}
        />
      )}
      <Card
        title={t('profile.activityTitle')}
        description={
          activity.length === 0 ? t('profile.activityEmpty') : t('profile.activityDescription')
        }
        actions={
          activity.length > 0 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/account/security">{t('profile.reviewSecurity')}</Link>
            </Button>
          ) : undefined
        }
      >
        {activity.length > 0 && (
          <ActivityList
            label={t('profile.activityLabel')}
            items={activity.map((event) => ({
              id: event.id,
              at: event.at,
              userAgent: event.userAgent,
              ip: event.ip,
              description: describeOwnActivity(event, actor.id, {
                account: t,
                audit: tAudit,
                roles: tRoles,
              }),
            }))}
          />
        )}
      </Card>
    </>
  );
}

/**
 * The Activity tab of the account.
 *
 * @returns The page.
 */
export default function AccountActivityPage({ searchParams }: PageProps<'/account/activity'>) {
  return (
    <Suspense fallback={<PageSkeleton header={false} />}>
      <Activity searchParams={searchParams} />
    </Suspense>
  );
}
