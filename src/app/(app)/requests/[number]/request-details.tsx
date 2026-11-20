/**
 * @file The details of a request next to its conversation: its status, who
 * it's assigned to, its type and (for the staff) priority, its company, who
 * raised it and when, when the staff first replied and when it last had
 * activity, with the controls its viewer may use. Its text comes from
 * `requests.detail`.
 */
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import Card from '@/components/ui/card';
import RelativeTime from '@/components/ui/relative-time';
import TextLink from '@/components/ui/text-link';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { RequestDetail } from '@/server/requests';

import {
  PriorityBadge,
  ReopenedBadge,
  StatusBadge,
  TypeBadge,
} from '../../_requests/request-badges';
import PersonLine, { PersonAvatar } from '../../_requests/request-person';

/**
 * One detail: its name above its value.
 *
 * @param props - Component props.
 * @param props.term - What it is, e.g. "Status".
 * @param props.children - Its value.
 * @returns The term and its value.
 */
function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm wrap-anywhere text-foreground">
        {children}
      </dd>
    </div>
  );
}

/**
 * The Details card of a request's page. The status is a select for the
 * staff who work on requests (`statusControl`), a label for everyone else;
 * a reopened request says so next to it. Everyone sees who it's assigned
 * to, one person per line with their avatar, without the staff label (only
 * staff are assigned), and the staff who work on requests get the
 * buttons that change it below them (`assigneeControls`). Readers who don't
 * get the priority see no row for it. The first response is how long the staff took to reply
 * for the first time, with the moment itself on hover; a request the staff
 * raised themselves has none to wait for.
 *
 * In one column next to the conversation on a wide screen, and in two
 * columns above it otherwise, in one on a phone.
 *
 * @param props - Component props.
 * @param props.detail - The request, as its reader gets it.
 * @param props.statusControl - The staff's status select, instead of the status label.
 * @param props.assigneeControls - The staff's "Assign to me" and "Change assignees" buttons.
 * @param props.controls - The buttons under the details: Edit details, or Mark as done, Cancel
 *   request and Reopen.
 * @returns The card.
 */
export default async function RequestDetails({
  detail,
  statusControl = null,
  assigneeControls = null,
  controls = null,
}: {
  detail: RequestDetail;
  statusControl?: ReactNode;
  assigneeControls?: ReactNode;
  controls?: ReactNode;
}) {
  const [t, locale] = await Promise.all([getTranslations('requests.detail'), getLocale()]);
  const names = { company: detail.company.name, staff: detail.staffName };

  return (
    <Card title={t('details')}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-1">
        <Detail term={t('status')}>
          {statusControl || <StatusBadge status={detail.status} audience={detail.audience} />}
          {detail.reopenedAt && <ReopenedBadge />}
        </Detail>
        <Detail term={t('assignedTo')}>
          <div className="flex w-full min-w-0 flex-col gap-2">
            {detail.assignees.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {detail.assignees.map((person, index) => (
                  // eslint-disable-next-line react/no-array-index-key -- readers at the company get no IDs, and the list is read whole on each render
                  <li key={index} className="flex min-w-0 items-center gap-2">
                    <PersonAvatar person={person} names={names} size="xs" />
                    {/* Only staff are assigned: no label to say so. */}
                    <PersonLine person={person} names={names} sideLabel={false} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">{t('notAssigned')}</span>
            )}
            {assigneeControls && <div className="flex flex-wrap gap-2">{assigneeControls}</div>}
          </div>
        </Detail>
        <Detail term={t('type')}>
          <TypeBadge type={detail.type} />
        </Detail>
        {detail.priority && (
          <Detail term={t('priority')}>
            <PriorityBadge priority={detail.priority} short />
          </Detail>
        )}
        <Detail term={t('company')}>
          <TextLink standalone href={`/companies/${detail.company.slug}`}>
            {detail.company.name}
          </TextLink>
        </Detail>
        <Detail term={t('raisedBy')}>
          <PersonLine person={detail.raisedBy} names={names} />
        </Detail>
        <Detail term={t('raised')}>
          <time dateTime={detail.createdAt.toISOString()}>
            {formatDateTime(detail.createdAt, locale)}
          </time>
        </Detail>
        {/* The staff's own request has no first response to wait for. */}
        {detail.raisedBy.side === 'company' && (
          <Detail term={t('firstResponse')}>
            {detail.firstResponseAt ? (
              <time
                dateTime={detail.firstResponseAt.toISOString()}
                title={formatDateTime(detail.firstResponseAt, locale)}
              >
                {t('firstResponseAfter', {
                  duration: formatDuration(
                    detail.firstResponseAt.getTime() - detail.createdAt.getTime(),
                    locale,
                  ),
                })}
              </time>
            ) : (
              <span className="text-muted-foreground">{t('noResponse')}</span>
            )}
          </Detail>
        )}
        <Detail term={t('lastActivity')}>
          <RelativeTime date={detail.lastActivityAt} />
        </Detail>
      </dl>
      {controls && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-5">
          {controls}
        </div>
      )}
    </Card>
  );
}
