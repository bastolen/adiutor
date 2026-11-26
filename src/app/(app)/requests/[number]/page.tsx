/**
 * @file A request's page, served at `/requests/[number]`: its description
 * (what was asked, by whom), its conversation, and next to them its details:
 * status, who it's assigned to and who is subscribed, type and (for the
 * staff) priority, company, who raised it and when, the staff's first
 * response and its last activity.
 * The number as people see it, with the staff's current prefix
 * (`/requests/AD-142`), redirects here, as do the short links `/r/142` and
 * `/r/AD-142`.
 * Everyone who may see the request may open it: the staff, and the members
 * of its company while it's active. Anyone else gets the 404 page, as for a
 * number no request has.
 *
 * Everyone who reads it chooses which groups of its activity the
 * conversation shows (replies, internal notes for the staff, status changes,
 * other changes) and its order; that's saved with their account, and with
 * the newest first the reply form comes before the activity.
 *
 * Those who take part can reply. The staff who work on requests also pick
 * its status, assign it and edit its title, type and priority; people at the company
 * mark it done, cancel it or reopen it. Everyone who reads it can subscribe
 * to it, and the staff who work on requests and the company's Admins change
 * who else is subscribed. A deactivated company's requests show no controls:
 * they can only be read. Who may do what comes from the rules in
 * `src/lib/requests/rules.ts` (`mayContribute`, `statusChoices`,
 * `mayChangeStatus`, `mayWaitWithReply`, `mayProposeSolution`, ...), which the
 * services apply too.
 */
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import WidePage from '@/components/layout/wide-page';
import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import RelativeTime from '@/components/ui/relative-time';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import TextLink from '@/components/ui/text-link';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import cn from '@/lib/cn';
import ClientMessages from '@/lib/i18n/client-messages';
import {
  DESCRIPTION_ANCHOR,
  formatRequestNumber,
  mayAnswerSolution,
  mayChangeStatus,
  mayContribute,
  mayProposeSolution,
  mayWaitWithReply,
  mayWriteNote,
  offeredActivityGroups,
  parseRequestNumber,
  REQUEST_STATUSES,
  requestPath,
  statusChoices,
  subscriberScope,
} from '@/lib/requests';
import { searchParam, type SearchParams } from '@/lib/search-params';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { checkedPageMetadata } from '@/server/page-metadata';
import {
  findRequest,
  findRequestNumber,
  getRequest,
  listAssignableStaff,
  listRequestTypes,
  listSubscribable,
  MAX_EARLIER_CHUNKS,
  type RequestDetail,
} from '@/server/requests';

import RaisedForNote from '../../_requests/raised-for-note';
import PersonLine, { PersonAvatar, personName } from '../../_requests/request-person';
import RequestText from '../../_requests/request-text';
import SignedInAsMark from '../../_requests/signed-in-as-mark';
import { changeAssigneesAction, changeStatusAction, changeSubscriptionAction } from './actions';
import { ActivityControls, ActivityError, ActivityViewProvider } from './activity-view';
import ChangeAssignees, { type AssigneeChoice } from './change-assignees';
import ChangeSubscribers from './change-subscribers';
import EditDetails, { type EditableType } from './edit-details';
import EditableText from './editable-text';
import EditedNote from './edited-note';
import ReplyForm from './reply-form';
import RequestDetails from './request-details';
import SolutionNotice from './solution-notice';
import StatusSelect from './status-select';
import Thread from './thread';
import WriteTabs from './write-tabs';

/**
 * Page metadata: "Request AD-142 · Adiutor" for those who may see the
 * request, and the 404 page's title for everyone else, who get the 404 page.
 * It names the request by its number, never by its title: titles end up in
 * the browser history, and a request's title is something a person wrote.
 */
// i18n-check t('requests.detail.title')
export const generateMetadata = checkedPageMetadata(
  'requests.detail.title',
  async (actor, { params }: PageProps<'/requests/[number]'>) => {
    try {
      const { number, prefix } = await findRequest(appContext, actor, (await params).number);
      return { reference: formatRequestNumber(prefix, number) };
    } catch (error) {
      if (error instanceof ServiceError) {
        return null;
      }
      throw error;
    }
  },
);

/** How many earlier chunks of the conversation an address asks for: `?earlier=2`. */
const EARLIER_PATTERN = /^[1-9]\d?$/;

/**
 * Loads and shows a request, with the controls its viewer may use. An
 * address with the number as people see it (`AD-142`, the current prefix)
 * redirects to the digits first. The client components below (`ReplyForm`,
 * `StatusSelect`, `EditDetails`, `ChangeAssignees`, `ChangeSubscribers`) get
 * `requests` through `ClientMessages`.
 *
 * @param props - Component props.
 * @param props.params - Route parameters: the request's number.
 * @param props.searchParams - Query parameters: `earlier`, how many earlier chunks of the
 *   conversation to show besides the latest, and `entry`, the entry a link (from an email)
 *   points at, which the conversation shows whatever groups the reader chose, with everything
 *   down to it.
 */
async function RequestContent({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations('requests.detail');
  const tRequests = await getTranslations('requests');
  const actor = await getActor();
  const [{ number }, query] = await Promise.all([params, searchParams]);
  // The number as people see it, with the current prefix (`AD-142`): the page is at the digits.
  if (parseRequestNumber(number) === null) {
    const digits = await findRequestNumber(appContext, number);
    if (digits !== null) {
      redirect(requestPath(digits));
    }
  }
  const asked = searchParam(query.earlier);
  const earlier =
    asked && EARLIER_PATTERN.test(asked) ? Math.min(Number(asked), MAX_EARLIER_CHUNKS) : 0;
  // The entry a link points at (`?entry=<id>#entry-<id>`): shown whatever groups the reader chose,
  // and with everything newer than it, however far back it is.
  const entry = searchParam(query.entry);
  let detail: RequestDetail;
  try {
    detail = await getRequest(appContext, actor, number, { earlier, entry });
  } catch (error) {
    // A request the viewer may not see ends on the 404 page, like one that doesn't exist.
    if (error instanceof ServiceError) {
      notFound();
    }
    throw error;
  }
  // One chunk more than the page shows: more than asked for when the entry a link points at is
  // further back, since the conversation then shows everything down to it.
  const earlierHref =
    detail.earlierEntries > 0 && detail.earlierChunks < MAX_EARLIER_CHUNKS
      ? `${requestPath(detail.number)}?${new URLSearchParams({
          earlier: String(detail.earlierChunks + 1),
          ...(entry && { entry }),
        })}`
      : null;
  // Nobody changes the requests of a deactivated company; the services refuse it too.
  const contributes = mayContribute(detail.permissions, detail.company);
  const manages = contributes && detail.permissions.has('requests:manage');
  // What someone at the company may do with the request as it is: close it, or reopen it.
  const choices = contributes && !manages ? statusChoices(detail.permissions, detail.status) : [];
  const fields = { request: String(detail.number) };
  // "Send and wait for the company": only on a request that's worked on and doesn't wait already.
  const canWait = manages && mayWaitWithReply(detail.permissions, detail.status);
  // "Send as solution": the staff, on a request that's worked on and doesn't wait for approval.
  const canPropose = manages && mayProposeSolution(detail.permissions, detail.status);
  // The company's Admins and Clients answer a solution that waits for them.
  const answers = contributes && mayAnswerSolution(detail.permissions, detail.status);
  // Who the staff may assign: everyone who can be, and anyone assigned now who no longer could
  // be (gone meanwhile), so the dialog can still remove them.
  const assigned = detail.assignees.flatMap(({ userId }) => (userId ? [userId] : []));
  const assigneeChoices: AssigneeChoice[] = [];
  // The types the request can be given: the active ones, and the one it has, archived or not.
  const typeChoices: EditableType[] = [];
  if (manages) {
    const [staff, types] = await Promise.all([
      listAssignableStaff(appContext, actor),
      listRequestTypes(appContext, actor),
    ]);
    types.forEach(({ key, name, startingPriority, archived }) => {
      if (startingPriority && (!archived || key === detail.type)) {
        typeChoices.push({ key, name, startingPriority });
      }
    });
    assigneeChoices.push(...staff.map(({ id, name }) => ({ id, name, isViewer: id === actor.id })));
    detail.assignees.forEach(({ userId, name, isViewer }) => {
      if (userId && !staff.some(({ id }) => id === userId)) {
        assigneeChoices.push({ id: userId, name, isViewer });
      }
    });
  }
  // Whose subscriptions the viewer changes besides their own, and who they can subscribe then.
  const scope = detail.company.deactivated ? 'self' : subscriberScope(detail.permissions);
  const subscriberChoices =
    scope === 'self' ? [] : await listSubscribable(appContext, actor, String(detail.number));

  const names = { company: detail.company.name, staff: detail.staffName };
  // The request's whole address, for the note above code copied from its texts.
  const address = `${appContext.baseUrl}${requestPath(detail.number)}`;

  // What the reader writes: at the end of the activity, or before it with the newest first, set
  // apart from it by a line. Both are keyed, so a change of order moves them rather than starting
  // the reply form again: a reply that's half written stays.
  const newestFirst = detail.activity.order === 'newest';
  const thread = (
    <Thread key="thread" detail={detail} address={address} earlierHref={earlierHref} />
  );
  const writing = contributes && (
    <div
      key="writing"
      className={cn(
        'flex flex-col gap-6',
        detail.entries.length > 0 &&
          (newestFirst ? 'border-b border-border pb-6' : 'border-t border-border pt-6'),
      )}
    >
      {/* A solution that waits for the reader's answer: above the form, wherever it stands. */}
      {answers && <SolutionNotice request={detail.number} />}
      {mayWriteNote(detail.permissions) ? (
        // The staff who work on requests also write internal notes, on a tab of their own.
        <WriteTabs request={detail.number} canWait={canWait} canPropose={canPropose} />
      ) : (
        <ReplyForm request={detail.number} canWait={canWait} canPropose={canPropose} />
      )}
    </div>
  );

  const descriptionSource = {
    url: address,
    // Who wrote it: for a request raised for someone, the staff member who raised it for them.
    writer: personName(detail.raisedOnBehalf ?? detail.raisedBy, names),
    at: detail.createdAt,
  };
  const descriptionText = (
    <RequestText
      text={detail.description}
      id="description"
      className="text-sm text-foreground"
      source={descriptionSource}
      names={names}
    />
  );

  return (
    <ClientMessages namespaces={['requests']}>
      <PageHeader
        title={<span className="wrap-anywhere">{detail.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono">{formatRequestNumber(detail.prefix, detail.number)}</span>
            <span aria-hidden="true">·</span>
            <TextLink standalone href={`/companies/${detail.company.slug}`}>
              {detail.company.name}
            </TextLink>
          </span>
        }
        back={{ href: '/requests', label: t('back') }}
      />

      {/* Set by the redirect after the request was raised; not part of any link on this page. */}
      {searchParam(query.raised) === '1' && (
        <ToastOnArrival message={t('justRaised')} param="raised" />
      )}

      {detail.company.deactivated && <Alert tone="info">{t('deactivated')}</Alert>}

      {/* On a wide screen the details stand next to the description and the conversation; on a
          narrower one they come between the two, in the order they're read. */}
      {/* The first row is as tall as the description; what the details need beyond it goes to
          the second, so no gap opens between the description and the conversation. */}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[auto_1fr] xl:items-start">
        <div className="xl:col-start-1 xl:row-start-1">
          {/* Its anchor is where an email about a mention in the description links to. */}
          <Card id={DESCRIPTION_ANCHOR} title={t('description')}>
            {/* Who asked and when, then what they asked, across the card's full width. */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <PersonAvatar person={detail.raisedBy} names={names} />
                <PersonLine person={detail.raisedBy} names={names}>
                  <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                    <RelativeTime date={detail.createdAt} />
                    {detail.raisedOnBehalf && (
                      <RaisedForNote
                        staff={detail.raisedOnBehalf}
                        person={detail.raisedBy}
                        names={names}
                      />
                    )}
                    <SignedInAsMark
                      mark={detail.raisedSignedInAs}
                      author={detail.raisedOnBehalf ?? detail.raisedBy}
                      names={names}
                    />
                    <EditedNote
                      text={detail.description}
                      id="description"
                      source={descriptionSource}
                      names={names}
                    />
                  </span>
                </PersonLine>
              </div>
              {detail.description.edit ? (
                <EditableText request={detail.number} entry={null} edit={detail.description.edit}>
                  {descriptionText}
                </EditableText>
              ) : (
                descriptionText
              )}
            </div>
          </Card>
        </div>

        <div className="xl:col-start-2 xl:row-span-2 xl:row-start-1">
          <RequestDetails
            detail={detail}
            statusControl={
              manages ? (
                <StatusSelect
                  request={detail.number}
                  status={detail.status}
                  // The status it has and the ones the staff may move it to: waiting for
                  // approval comes only with "Send as solution", so the select only shows it
                  // while the request has it.
                  options={REQUEST_STATUSES.filter(
                    (status) =>
                      status === detail.status ||
                      mayChangeStatus(detail.permissions, detail.status, status),
                  ).map((status) => ({
                    value: status,
                    label: tRequests('status', { status, audience: detail.audience }),
                  }))}
                />
              ) : null
            }
            assigneeControls={
              manages && (
                <>
                  {!detail.assignees.some(({ isViewer }) => isViewer) && (
                    <RowAction
                      action={changeAssigneesAction}
                      allowedWhileSignedInAs
                      fields={{ ...fields, add: actor.id }}
                      label={tRequests('controls.assignToMe')}
                      doneMessage={tRequests('saved.assignedYou')}
                    />
                  )}
                  <ChangeAssignees
                    request={detail.number}
                    choices={assigneeChoices}
                    assigned={assigned}
                  />
                </>
              )
            }
            subscriberControls={
              !detail.company.deactivated && (
                <>
                  {/* Someone it's assigned to follows it as that. One button that stays where it
                      is, so the keyboard keeps its place when its text changes. */}
                  {!detail.assignees.some(({ isViewer }) => isViewer) && (
                    <RowAction
                      action={changeSubscriptionAction}
                      allowedWhileSignedInAs
                      fields={{ ...fields, subscribe: detail.subscribed ? 'no' : 'yes' }}
                      label={
                        detail.subscribed
                          ? tRequests('controls.unsubscribe')
                          : tRequests('controls.subscribe')
                      }
                    />
                  )}
                  {scope !== 'self' && (
                    <ChangeSubscribers
                      request={detail.number}
                      choices={subscriberChoices}
                      company={detail.company.name}
                      scope={scope}
                    />
                  )}
                </>
              )
            }
            controls={
              (manages || choices.length > 0) && (
                <>
                  {manages && detail.priority && (
                    <EditDetails
                      request={detail.number}
                      details={{
                        title: detail.title,
                        type: detail.type,
                        priority: detail.priority,
                      }}
                      types={typeChoices}
                    />
                  )}
                  {choices.includes('done') && (
                    <RowAction
                      action={changeStatusAction}
                      allowedWhileSignedInAs
                      fields={{ ...fields, status: 'done', from: detail.status }}
                      label={tRequests('controls.markDone')}
                      variant="primary"
                    />
                  )}
                  {choices.includes('cancelled') && (
                    <RowAction
                      action={changeStatusAction}
                      allowedWhileSignedInAs
                      fields={{ ...fields, status: 'cancelled', from: detail.status }}
                      label={tRequests('controls.cancel')}
                      confirm={{
                        title: tRequests('controls.cancelTitle'),
                        description: tRequests('controls.cancelDescription'),
                        // "Cancel" next to "Cancel request" would say nothing.
                        cancelLabel: tRequests('controls.keep'),
                      }}
                    />
                  )}
                  {choices.includes('open') && (
                    <RowAction
                      action={changeStatusAction}
                      allowedWhileSignedInAs
                      fields={{ ...fields, status: 'open', from: detail.status }}
                      label={tRequests('controls.reopen')}
                    />
                  )}
                </>
              )
            }
          />
        </div>

        <div className="xl:col-start-1 xl:row-start-2">
          <ActivityViewProvider
            view={detail.activity}
            offered={offeredActivityGroups(detail.permissions)}
          >
            <Card title={t('conversation')} actions={<ActivityControls />}>
              <div className="flex flex-col gap-6">
                <ActivityError />
                {newestFirst ? [writing, thread] : [thread, writing]}
              </div>
            </Card>
          </ActivityViewProvider>
        </div>
      </div>
    </ClientMessages>
  );
}

/**
 * The request page.
 */
export default function RequestPage({ params, searchParams }: PageProps<'/requests/[number]'>) {
  // A request is text to read and write: on a wide screen it gets more room than other pages.
  return (
    <WidePage>
      <Suspense fallback={<PageSkeleton />}>
        <RequestContent params={params} searchParams={searchParams} />
      </Suspense>
    </WidePage>
  );
}
