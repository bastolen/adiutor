/**
 * @file A request's conversation: every reply, every internal note (which
 * only the staff get from the service), every change of its status, title,
 * type or priority, and everyone assigned or removed, in the groups and
 * order the reader chose (oldest first unless they chose newest first; the
 * service applies the choice). Each entry names who wrote or changed it and
 * when, and, for the readers who may know, that a staff member did it while
 * signed in as its author. What was asked is the page's Description, above
 * it. Its text comes from the `requests` namespace.
 */
import { CircleDot, Flag, Lock, type LucideIcon, Pencil, Tag, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import Badge from '@/components/ui/badge';
import RelativeTime from '@/components/ui/relative-time';
import cn from '@/lib/cn';
import {
  isReopening,
  isRequestPriority,
  isRequestStatus,
  type RequestAudience,
  type WrittenEntryKind,
} from '@/lib/requests';
import type { RequestDetail, RequestEntryView, RequestPerson } from '@/server/requests';

import PersonLine, {
  PersonAvatar,
  personName,
  type SideNames,
} from '../../_requests/request-person';
import RequestText from '../../_requests/request-text';
import SignedInAsMark from '../../_requests/signed-in-as-mark';
import { ShowEverythingButton } from './activity-view';
import EditableText from './editable-text';
import EditedNote from './edited-note';
import ShowEarlierLink from './show-earlier-link';

/** The icon of each kind of change. */
const CHANGE_ICONS: Record<Exclude<RequestEntryView['kind'], WrittenEntryKind>, LucideIcon> = {
  status: CircleDot,
  title: Pencil,
  type: Tag,
  priority: Flag,
  assignee: UserRound,
};

/**
 * One entry of the conversation: something in front (an avatar, or an
 * icon), who it's by and when, and what they wrote or changed below.
 *
 * @param props - Component props.
 * @param props.leading - What stands in front: the person's avatar, or a change's icon.
 * @param props.person - Who wrote or changed it.
 * @param props.names - The names of the two sides.
 * @param props.at - When.
 * @param props.afterTime - What follows the time: a note's badge, the mark of work done while
 *   signed in as its author, and "Edited" for an edited text.
 * @param props.children - What they wrote or changed.
 * @returns The list item.
 */
function Entry({
  leading,
  person,
  names,
  at,
  afterTime = null,
  children,
}: {
  leading: ReactNode;
  person: RequestPerson;
  names: SideNames;
  at: Date;
  afterTime?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <PersonLine person={person} names={names}>
          <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
            <RelativeTime date={at} />
            {afterTime}
          </span>
        </PersonLine>
        {children}
      </div>
    </li>
  );
}

/**
 * What a change did, as a sentence without its subject (the entry's first
 * line names who made it): "Changed the status from Open to In progress."
 * Closing and reopening a request have sentences of their own, and so does
 * someone who assigned or removed themselves. Someone assigned or removed
 * whose account is gone is "a staff member". A value this version doesn't
 * know is shown as it was stored.
 *
 * @param props - Component props.
 * @param props.entry - The change.
 * @param props.audience - Who reads it, for the wording of a status.
 * @returns The sentence.
 */
function ChangeText({ entry, audience }: { entry: RequestEntryView; audience: RequestAudience }) {
  const t = useTranslations('requests');
  const from = entry.from ?? '';
  const to = entry.to ?? '';
  /**
   * A status as the reader knows it.
   *
   * @param status - The stored status.
   * @returns Its label.
   */
  const statusLabel = (status: string) =>
    isRequestStatus(status) ? t('status', { status, audience }) : status;

  switch (entry.kind) {
    case 'status': {
      let change = 'moved';
      if (isRequestStatus(from) && isRequestStatus(to) && isReopening(from, to)) {
        change = 'reopened';
      } else if (to === 'done' || to === 'cancelled') {
        change = to;
      }
      return t('entry.status', { change, from: statusLabel(from), to: statusLabel(to) });
    }
    case 'type':
      // The service gives the types' names.
      return t('entry.type', { from, to });
    case 'priority':
      return t('entry.priority', {
        from: isRequestPriority(from) ? t('priority', { priority: from }) : from,
        to: isRequestPriority(to) ? t('priority', { priority: to }) : to,
      });
    case 'assignee':
      return t('entry.assignee', {
        change: to === 'unassigned' ? 'unassigned' : 'assigned',
        self: entry.subjectIsAuthor ? 'yes' : 'no',
        known: entry.subject?.name ? 'yes' : 'no',
        name: entry.subject?.name ?? '',
      });
    default:
      return t('entry.title', { from, to });
  }
}

/**
 * The conversation of a request: its entries, in the reader's order. When
 * the request has more entries than are loaded, a link to show earlier ones
 * comes before the oldest one shown: first with the oldest first, last with
 * the newest first. Without any entry yet, it says so; when the groups the
 * reader chose leave nothing to show, it says that instead, with a button
 * that shows everything again (in an `ActivityViewProvider`).
 *
 * @param props - Component props.
 * @param props.detail - The request, as its reader gets it.
 * @param props.address - The whole address of the request's page, for the note above code copied from a reply.
 * @param props.earlierHref - The page with earlier entries, or `null` when all are shown.
 * @returns The list of entries, or a line saying there are none.
 */
export default function Thread({
  detail,
  address,
  earlierHref,
}: {
  detail: RequestDetail;
  address: string;
  earlierHref: string | null;
}) {
  const t = useTranslations('requests.detail');
  const tNote = useTranslations('requests.note');
  const names: SideNames = { company: detail.company.name, staff: detail.staffName };

  if (detail.entries.length === 0 && detail.activity.groups !== null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{t('activity.nothingShown')}</p>
        <ShowEverythingButton>{t('activity.showEverything')}</ShowEverythingButton>
      </div>
    );
  }
  if (detail.entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noReplies')}</p>;
  }

  const earlierLink = earlierHref && (
    <li>
      <ShowEarlierLink href={earlierHref}>
        {t('showEarlier', { count: detail.earlierEntries })}
      </ShowEarlierLink>
    </li>
  );
  const newestFirst = detail.activity.order === 'newest';

  return (
    <ol className="flex flex-col gap-5">
      {!newestFirst && earlierLink}
      {detail.entries.map((entry) => {
        if (entry.kind === 'comment' || entry.kind === 'note') {
          // An internal note reads like a reply, on the amber surface and with a badge that says
          // only the staff see it.
          const note = entry.kind === 'note';
          const source = {
            url: address,
            writer: personName(entry.author, names),
            at: entry.createdAt,
          };
          const text = entry.body && (
            <RequestText
              text={entry.body}
              id={entry.id}
              className={cn(
                'rounded-lg px-3 py-2 text-sm text-foreground',
                note ? 'bg-warning-soft' : 'bg-muted',
              )}
              source={source}
              names={names}
            />
          );
          return (
            <Entry
              key={entry.id}
              leading={<PersonAvatar person={entry.author} names={names} />}
              person={entry.author}
              names={names}
              at={entry.createdAt}
              afterTime={
                <>
                  {note && (
                    <Badge tone="warning">
                      <Lock aria-hidden="true" className="mr-1 size-3" />
                      {tNote('badge')}
                    </Badge>
                  )}
                  <SignedInAsMark mark={entry.signedInAs} author={entry.author} names={names} />
                  {entry.body && (
                    <EditedNote text={entry.body} id={entry.id} source={source} names={names} />
                  )}
                </>
              }
            >
              {entry.body?.edit ? (
                <EditableText
                  request={detail.number}
                  entry={entry.id}
                  note={note}
                  edit={entry.body.edit}
                >
                  {text}
                </EditableText>
              ) : (
                text
              )}
            </Entry>
          );
        }
        const Icon = CHANGE_ICONS[entry.kind];
        return (
          <Entry
            key={entry.id}
            leading={
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
                <Icon aria-hidden="true" className="size-4" />
              </span>
            }
            person={entry.author}
            names={names}
            at={entry.createdAt}
            afterTime={
              <SignedInAsMark mark={entry.signedInAs} author={entry.author} names={names} />
            }
          >
            <p className="text-sm wrap-anywhere text-muted-foreground">
              <ChangeText entry={entry} audience={detail.audience} />
            </p>
          </Entry>
        );
      })}
      {newestFirst && earlierLink}
    </ol>
  );
}
