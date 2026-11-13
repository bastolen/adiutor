/**
 * @file A request's page, served at `/requests/[number]`: its description
 * (what was asked, by whom), its conversation, and next to them its details:
 * status, type and (for the staff) priority, company, who raised it and
 * when, the staff's first response and its last activity.
 * Everyone who may see the request may open it: the staff, and the members
 * of its company while it's active. Anyone else gets the 404 page, as for a
 * number no request has.
 *
 * Those who take part can reply. The staff who work on requests also pick
 * its status and edit its title, type and priority; people at the company
 * mark it done, cancel it or reopen it. A deactivated company's requests
 * show no controls: they can only be read.
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import RelativeTime from '@/components/ui/relative-time';
import RowAction from '@/components/ui/row-action';
import { PageSkeleton } from '@/components/ui/skeleton';
import TextLink from '@/components/ui/text-link';
import ToastOnArrival from '@/components/ui/toast-on-arrival';
import ClientMessages from '@/lib/i18n/client-messages';
import {
  formatRequestNumber,
  isClosedStatus,
  REQUEST_STATUSES,
  requestPath,
  statusChoices,
} from '@/lib/requests';
import { searchParam, type SearchParams } from '@/lib/search-params';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { checkedPageMetadata } from '@/server/page-metadata';
import { findRequest, getRequest, MAX_EARLIER_CHUNKS, type RequestDetail } from '@/server/requests';

import PersonLine, { PersonAvatar } from '../../_requests/request-person';
import RequestText from '../../_requests/request-text';
import { changeStatusAction } from './actions';
import EditDetails from './edit-details';
import ReplyForm from './reply-form';
import RequestDetails from './request-details';
import StatusSelect from './status-select';
import Thread from './thread';

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
 * Loads and shows a request, with the controls its viewer may use. The
 * client components below (`ReplyForm`, `StatusSelect`, `EditDetails`) get
 * `requests` through `ClientMessages`.
 *
 * @param props - Component props.
 * @param props.params - Route parameters: the request's number.
 * @param props.searchParams - Query parameters: `earlier`, how many earlier chunks of the
 *   conversation to show besides the latest.
 * @returns The page content.
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
  const asked = searchParam(query.earlier);
  const earlier =
    asked && EARLIER_PATTERN.test(asked) ? Math.min(Number(asked), MAX_EARLIER_CHUNKS) : 0;
  let detail: RequestDetail;
  try {
    detail = await getRequest(appContext, actor, number, { earlier });
  } catch (error) {
    // A request the viewer may not see ends on the 404 page, like one that doesn't exist.
    if (error instanceof ServiceError) {
      notFound();
    }
    throw error;
  }
  const earlierHref =
    detail.earlierEntries > 0 && earlier < MAX_EARLIER_CHUNKS
      ? `${requestPath(detail.number)}?earlier=${earlier + 1}`
      : null;
  // Nobody changes the requests of a deactivated company; the services refuse it too.
  const contributes = !detail.company.deactivated && detail.permissions.has('requests:contribute');
  const manages = contributes && detail.permissions.has('requests:manage');
  // What someone at the company may do with the request as it is: close it, or reopen it.
  const choices = contributes && !manages ? statusChoices(detail.permissions, detail.status) : [];
  const fields = { request: String(detail.number) };

  const names = { company: detail.company.name, staff: detail.staffName };

  return (
    <ClientMessages namespaces={['requests']}>
      <PageHeader
        title={<span className="wrap-anywhere">{detail.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono">{formatRequestNumber(detail.prefix, detail.number)}</span>
            <span aria-hidden="true">·</span>
            <TextLink href={`/companies/${detail.company.slug}`}>{detail.company.name}</TextLink>
          </span>
        }
        back={{ href: '/requests', label: t('back') }}
      />

      {/* Set by the redirect after the request was raised; not part of any link on this page. */}
      {searchParam(query.raised) === '1' && <ToastOnArrival message={t('justRaised')} />}

      {detail.company.deactivated && <Alert tone="info">{t('deactivated')}</Alert>}

      {/* On a wide screen the details stand next to the description and the conversation; on a
          narrower one they come between the two, in the order they're read. */}
      {/* The first row is as tall as the description; what the details need beyond it goes to
          the second, so no gap opens between the description and the conversation. */}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[auto_1fr] xl:items-start">
        <div className="xl:col-start-1 xl:row-start-1">
          <Card title={t('description')}>
            {/* Who asked and when, then what they asked, across the card's full width. */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <PersonAvatar person={detail.raisedBy} names={names} />
                <PersonLine person={detail.raisedBy} names={names}>
                  <span className="text-muted-foreground">
                    <RelativeTime date={detail.createdAt} />
                  </span>
                </PersonLine>
              </div>
              <RequestText text={detail.description} className="text-sm text-foreground" />
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
                  options={REQUEST_STATUSES.map((status) => ({
                    value: status,
                    label: tRequests('status', { status, audience: detail.audience }),
                  }))}
                />
              ) : null
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
                    />
                  )}
                  {choices.includes('done') && (
                    <RowAction
                      action={changeStatusAction}
                      fields={{ ...fields, status: 'done' }}
                      label={tRequests('controls.markDone')}
                      variant="primary"
                    />
                  )}
                  {choices.includes('cancelled') && (
                    <RowAction
                      action={changeStatusAction}
                      fields={{ ...fields, status: 'cancelled' }}
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
                      fields={{ ...fields, status: 'open' }}
                      label={tRequests('controls.reopen')}
                    />
                  )}
                </>
              )
            }
          />
        </div>

        <div className="xl:col-start-1 xl:row-start-2">
          <Card title={t('conversation')}>
            <div className="flex flex-col gap-6">
              <Thread detail={detail} earlierHref={earlierHref} />
              {contributes && (
                <div className={detail.entries.length > 0 ? 'border-t border-border pt-6' : ''}>
                  <ReplyForm
                    request={detail.number}
                    // Only on a request that's worked on and doesn't wait for the company already.
                    canWait={
                      manages && !isClosedStatus(detail.status) && detail.status !== 'waiting'
                    }
                  />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </ClientMessages>
  );
}

/**
 * The request page.
 *
 * @param props - Page props from Next.js.
 * @param props.params - Route parameters.
 * @param props.searchParams - Query parameters.
 * @returns The page.
 */
export default function RequestPage({ params, searchParams }: PageProps<'/requests/[number]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RequestContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
