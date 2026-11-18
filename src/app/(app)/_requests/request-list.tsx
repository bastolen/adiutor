/**
 * @file A list of requests with its filters, search, sorting and pages: the
 * requests the viewer may see across companies (`/requests`), or one
 * company's on its own page. Its text comes from `requests.list`.
 */
import { ChevronRight, Inbox, Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import FilterMenu from '@/components/ui/filter-menu';
import { paginationFooter } from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import RowLink from '@/components/ui/row-link';
import SearchForm from '@/components/ui/search-form';
import SegmentedNav from '@/components/ui/segmented-nav';
import SortMenu from '@/components/ui/sort-menu';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import {
  DEFAULT_REQUEST_STATUS_FILTER,
  formatRequestNumber,
  isRequestPriority,
  isRequestStatusFilter,
  isRequestType,
  REQUEST_PRIORITIES,
  REQUEST_STATUS_FILTERS,
  REQUEST_TYPES,
  requestPath,
  type RequestStatusFilter,
} from '@/lib/requests';
import { type SearchParams, searchParam } from '@/lib/search-params';
import { createPageUrl } from '@/lib/tables/page-url';
import { parseTableState, type TableDefinition } from '@/lib/tables/table-state';
import { REQUESTS_TABLE, STAFF_REQUESTS_TABLE } from '@/lib/tables/tables';
import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import { getStaffPermissionsInCompanies } from '@/server/authz';
import { getRequestSettings, listRequestCompanies, listRequests } from '@/server/requests';

import { PriorityBadge, ReopenedBadge, StatusBadge } from './request-badges';

/**
 * The link to the form that raises a request, as a button.
 *
 * @param props - Component props.
 * @param props.company - The URL name of the company to raise it in, when the list is one company's.
 * @param props.label - The button's text.
 * @returns The button.
 */
export function NewRequestButton({
  company = undefined,
  label,
}: {
  company?: string;
  label: string;
}) {
  const href = company ? `/requests/new?company=${encodeURIComponent(company)}` : '/requests/new';
  return (
    <Button asChild>
      <Link href={href}>
        <Plus aria-hidden="true" className="size-4" />
        {label}
      </Link>
    </Button>
  );
}

/**
 * Props for {@link RequestList}.
 */
interface RequestListProps {
  /** The page the list is on, e.g. `/requests`: what its links are built from. */
  path: string;
  /** The page's query parameters: the search, the filters, and the table's sort and page. */
  searchParams: SearchParams;
  /** The viewer. */
  actor: Actor;
  /**
   * The company whose list this is (its URL name), on a company's own page.
   * Without it, the list covers every company the viewer sees, and can be
   * filtered by one.
   */
  company?: string;
}

/** Why a list without requests is empty: nothing matches, nothing is active, or there are none. */
type EmptyKind = 'noMatch' | 'active' | 'none';

/**
 * Works out why a list without requests is empty. A search, a company, a
 * type or a priority narrows the list down, and so do the Waiting and Closed
 * links: nothing matches them. Active is where the list starts, and All
 * leaves no request out, so a list that's empty under All without a search
 * or a filter has no requests yet.
 *
 * @param status - The status link the list is on.
 * @param narrowed - Whether a search or one of the filter menus is in use.
 * @returns What the empty list is about.
 */
function emptyKindOf(status: RequestStatusFilter, narrowed: boolean): EmptyKind {
  if (narrowed) {
    return 'noMatch';
  }
  if (status === 'active') {
    return 'active';
  }
  return status === 'all' ? 'none' : 'noMatch';
}

/**
 * The requests the viewer may see, with what narrows them down: a row of
 * status links (the requests that are still worked on first), a search by
 * title or number, and menus for the company (when there's more than one to
 * choose from), the type and, for the staff, the priority, next to the Sort
 * menu.
 *
 * Each row is one link to its request. From tablet width the status and the
 * last activity have columns of their own, and the staff get a Priority
 * column; below that they go under the title. Company users never get a
 * priority: the service leaves it out.
 *
 * An empty list says why it's empty ({@link emptyKindOf}) and, unless a
 * search or a filter emptied it, offers "New request" to whoever may raise
 * one.
 *
 * @param props - Component props.
 * @param props.path - The page the list is on.
 * @param props.searchParams - The page's query parameters.
 * @param props.actor - The viewer.
 * @param props.company - The company whose list this is, on its own page.
 * @returns The filters and the table (or an empty state).
 */
export default async function RequestList({
  path,
  searchParams,
  actor,
  company = undefined,
}: RequestListProps) {
  const t = await getTranslations('requests.list');
  const tRequests = await getTranslations('requests');
  // The staff see priorities; everyone else gets none from the service either.
  const internal = getStaffPermissionsInCompanies(actor).has('requests:view-internal');
  // One table, which the staff can also sort by priority.
  const definition: TableDefinition = internal ? STAFF_REQUESTS_TABLE : REQUESTS_TABLE;
  const search = searchParam(searchParams.q)?.trim() ?? '';
  const statusParam = searchParam(searchParams.status);
  const status = isRequestStatusFilter(statusParam) ? statusParam : DEFAULT_REQUEST_STATUS_FILTER;
  const typeParam = searchParam(searchParams.type);
  const type = isRequestType(typeParam) ? typeParam : undefined;
  const priorityParam = searchParam(searchParams.priority);
  const priority = internal && isRequestPriority(priorityParam) ? priorityParam : undefined;
  const requested = parseTableState(definition, searchParams);

  const [companies, settings] = await Promise.all([
    listRequestCompanies(appContext, actor),
    getRequestSettings(appContext),
  ]);
  // A company to filter by only counts when it's one the viewer sees.
  const companyParam = company ? undefined : searchParam(searchParams.company);
  const chosenCompany = companies.find(({ slug }) => slug === companyParam)?.slug;
  const requests = await listRequests(appContext, actor, {
    search,
    status,
    company: company ?? chosenCompany,
    type,
    priority,
    ...requested,
    // The table checked the sort against its own sorts; this only tells TypeScript which it is.
    sort:
      requested.sort === 'raised' || requested.sort === 'priority' ? requested.sort : 'activity',
  });

  // In the order the search form submits them, so links and searches agree.
  const filters = {
    status: status === DEFAULT_REQUEST_STATUS_FILTER ? undefined : status,
    company: chosenCompany,
    type,
    priority,
  };
  const table = createPageUrl(
    path,
    { ...filters, q: search },
    await getTranslations('tables'),
  ).table(definition, { ...requested, page: requests.page });
  const canRaise = company
    ? companies.some(({ slug, canRaise: may }) => slug === company && may)
    : companies.some(({ canRaise: may }) => may);
  // The company is named in each row only where the list can hold several.
  const showsCompany = !company && companies.length > 1;
  const newButton = canRaise && <NewRequestButton company={company} label={t('new')} />;
  // What an empty list says, and whether it invites a request: only where one would show up.
  const emptyKind = emptyKindOf(status, Boolean(search || chosenCompany || type || priority));
  const mayRaise = { canRaise: canRaise ? 'yes' : 'no' };
  let emptyText = { title: t('empty.noMatchTitle'), description: t('empty.noMatchDescription') };
  if (emptyKind === 'active') {
    emptyText = {
      title: t('empty.activeTitle'),
      description: t('empty.activeDescription', mayRaise),
    };
  } else if (emptyKind === 'none') {
    emptyText = {
      title: t('empty.noneTitle'),
      description: t('empty.noneDescription', mayRaise),
    };
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <SegmentedNav
          label={t('statusLabel')}
          items={REQUEST_STATUS_FILTERS.map((value) => ({
            href: table.withParams({
              status: value === DEFAULT_REQUEST_STATUS_FILTER ? undefined : value,
            }),
            label: t('statusOption', { status: value }),
            current: value === status,
          }))}
        />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SearchForm
            id="request-search"
            label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            defaultValue={search}
            hiddenFields={{
              ...Object.fromEntries(
                Object.entries(filters).filter(
                  (entry): entry is [string, string] => entry[1] !== undefined,
                ),
              ),
              ...table.hiddenFields(),
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {showsCompany && (
              <FilterMenu
                label={t('companyFilter')}
                menuLabel={t('companyMenu')}
                options={[
                  {
                    value: '',
                    label: t('allCompanies'),
                    href: table.withParams({ company: undefined }),
                    current: !chosenCompany,
                  },
                  ...companies.map(({ slug, name }) => ({
                    value: slug,
                    label: name,
                    href: table.withParams({ company: slug }),
                    current: slug === chosenCompany,
                  })),
                ]}
              />
            )}
            <FilterMenu
              label={t('typeFilter')}
              menuLabel={t('typeMenu')}
              options={[
                {
                  value: '',
                  label: t('allTypes'),
                  href: table.withParams({ type: undefined }),
                  current: !type,
                },
                ...REQUEST_TYPES.map((value) => ({
                  value,
                  label: tRequests('type', { type: value }),
                  href: table.withParams({ type: value }),
                  current: value === type,
                })),
              ]}
            />
            {internal && (
              <FilterMenu
                label={t('priorityFilter')}
                menuLabel={t('priorityMenu')}
                options={[
                  {
                    value: '',
                    label: t('allPriorities'),
                    href: table.withParams({ priority: undefined }),
                    current: !priority,
                  },
                  ...REQUEST_PRIORITIES.map((value) => ({
                    value,
                    label: tRequests('priority', { priority: value }),
                    href: table.withParams({ priority: value }),
                    current: value === priority,
                  })),
                ]}
              />
            )}
            {requests.total > 0 && <SortMenu label={t('rows')} options={table.sortOptions()} />}
          </div>
        </div>
      </div>

      <Card flush footer={paginationFooter(table, requests, t('rows'))}>
        {requests.total === 0 ? (
          <EmptyState
            icon={Inbox}
            title={emptyText.title}
            description={emptyText.description}
            action={emptyKind === 'noMatch' ? undefined : newButton || undefined}
          />
        ) : (
          <Table
            caption={table.caption(
              t('caption', { status, matching: search ? 'yes' : 'no', search }),
              requests,
            )}
          >
            <thead>
              <tr>
                <Th aria-sort={table.ariaSort('raised')}>{t('columns.request')}</Th>
                {/* Below tablet width the status, priority and activity go under the title. */}
                <Th className="hidden md:table-cell">{t('columns.status')}</Th>
                {internal && (
                  <Th aria-sort={table.ariaSort('priority')} className="hidden md:table-cell">
                    {t('columns.priority')}
                  </Th>
                )}
                <Th aria-sort={table.ariaSort('activity')} className="hidden md:table-cell">
                  {t('columns.activity')}
                </Th>
                <Th>
                  <span className="sr-only">{t('columns.open')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {requests.items.map((request) => {
                // Worded as on the request's own page: the service says how this reader is
                // addressed in each request's company.
                const labels = (
                  <>
                    <StatusBadge status={request.status} audience={request.audience} />
                    {request.reopened && <ReopenedBadge />}
                  </>
                );
                return (
                  <Tr key={request.id} className="group relative">
                    <Td>
                      <div className="flex min-w-0 flex-col gap-1">
                        {/* The link covers the whole row, so the row is one click target; on its own
                            it's 2px taller above and below too, like every text link (at least 24px). */}
                        <RowLink href={requestPath(request.number)}>{request.title}</RowLink>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs wrap-anywhere text-muted-foreground">
                          <span className="font-mono">
                            {formatRequestNumber(settings.prefix, request.number)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{tRequests('type', { type: request.type })}</span>
                          {showsCompany && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{request.company.name}</span>
                            </>
                          )}
                        </span>
                        {/* Below tablet width, what the other columns hold. */}
                        <span className="mt-1 flex flex-wrap items-center gap-2 md:hidden">
                          {labels}
                          {request.priority && <PriorityBadge priority={request.priority} />}
                        </span>
                        <span className="text-xs text-muted-foreground md:hidden">
                          <RelativeTime date={request.lastActivityAt} />
                        </span>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <span className="flex flex-wrap items-center gap-2">{labels}</span>
                    </Td>
                    {internal && (
                      <Td className="hidden md:table-cell">
                        {request.priority && <PriorityBadge priority={request.priority} short />}
                      </Td>
                    )}
                    <Td className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                      <RelativeTime date={request.lastActivityAt} />
                    </Td>
                    <Td className="w-10 text-right">
                      <ChevronRight
                        aria-hidden="true"
                        className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
