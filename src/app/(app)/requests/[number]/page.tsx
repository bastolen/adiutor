/**
 * @file A request's page, served at `/requests/[number]`: what was asked,
 * its status, type and (for the staff) priority, and its conversation.
 * Everyone who may see the request may open it: the staff, and the members
 * of its company while it's active. Anyone else gets the 404 page, as for a
 * number no request has.
 */
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import TextLink from '@/components/ui/text-link';
import { formatRequestNumber, requestPath } from '@/lib/requests';
import { searchParam, type SearchParams } from '@/lib/search-params';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { checkedPageMetadata } from '@/server/page-metadata';
import { findRequest, getRequest, MAX_EARLIER_CHUNKS, type RequestDetail } from '@/server/requests';

import RequestBadges from '../../_requests/request-badges';
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
 * Loads and shows a request.
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

  return (
    <>
      <PageHeader
        title={<span className="wrap-anywhere">{detail.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono">{formatRequestNumber(detail.prefix, detail.number)}</span>
            <span aria-hidden="true">·</span>
            <TextLink href={`/companies/${detail.company.slug}`}>{detail.company.name}</TextLink>
          </span>
        }
      >
        <RequestBadges
          status={detail.status}
          reopened={detail.reopenedAt !== null}
          type={detail.type}
          priority={detail.priority}
          audience={detail.audience}
        />
      </PageHeader>

      {detail.company.deactivated && <Alert tone="info">{t('deactivated')}</Alert>}

      <Card title={t('conversation')}>
        <Thread detail={detail} earlierHref={earlierHref} />
      </Card>
    </>
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
