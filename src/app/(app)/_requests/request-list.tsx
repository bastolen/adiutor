/**
 * @file A list of requests with its filters (`request-filters.tsx`), search,
 * sorting and pages: the
 * requests the viewer may see across companies (`/requests`), or one
 * company's on its own page. Its text comes from `requests.list`. The
 * Company filter names a company by its URL name too when another has the
 * same name (`companyChoiceLabels`).
 */
import { ChevronRight, Inbox, Plus } from 'lucide-react';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { paginationFooter } from '@/components/ui/pagination';
import RelativeTime from '@/components/ui/relative-time';
import RowLink from '@/components/ui/row-link';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatList } from '@/lib/format';
import { formatRequestNumber, requestPath, type RequestStatusFilter } from '@/lib/requests';
import type { SearchParams } from '@/lib/search-params';
import { createPageUrl } from '@/lib/tables/page-url';
import type { Actor } from '@/server/actor';
import appContext from '@/server/app-context';
import { getStaffPermissionsInCompanies } from '@/server/authz';
import {
  getRequestSettings,
  listAssignableStaff,
  listRequestCompanies,
  listRequestTypes,
  listRequests,
  type RequestListItem,
} from '@/server/requests';

import { PriorityBadge, ReopenedBadge, StatusBadge } from './request-badges';
import { RequestFilterBar, parseRequestFilters } from './request-filters';
import { PeopleAvatars, personName } from './request-person';

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
  /**
   * Renders what comes before the list (a page's header) from what the list
   * has loaded anyway, so the page needn't load it again: the name the staff
   * are shown with, and whether the viewer may raise a request in the
   * companies the list covers.
   */
  renderHeader?: (loaded: { staffName: string; canRaise: boolean }) => ReactNode;
}

/** Why a list without requests is empty: nothing matches, nothing is active, or there are none. */
type EmptyKind = 'noMatch' | 'active' | 'none';

/**
 * Works out why a list without requests is empty. A search, a company, a
 * type, a priority or an assignee narrows the list down, and so do the Waiting and Closed
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
 * choose from), the type and, for the staff, the priority and the assignee
 * (Me, for those who can be assigned, Not assigned, or one staff member),
 * next to the Sort menu.
 *
 * Each row is one link to its request. From tablet width the status and the
 * last activity have columns of their own, and the staff get a Priority
 * column, and an Assigned to column with an avatar per person (the name on
 * hover, and as text for screen readers); below that they go under the
 * title. Company users
 * never get a priority: the service leaves it out. They see who a request
 * is assigned to on its page.
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
 * @param props.renderHeader - Renders what comes before the list, from what the list loaded.
 * @returns The header, if any, the filters and the table (or an empty state).
 */
export default async function RequestList({
  path,
  searchParams,
  actor,
  company = undefined,
  renderHeader = undefined,
}: RequestListProps) {
  const t = await getTranslations('requests.list');
  const [companies, settings, assignable, types, locale] = await Promise.all([
    listRequestCompanies(appContext, actor),
    getRequestSettings(appContext),
    getStaffPermissionsInCompanies(actor).has('requests:view-internal')
      ? listAssignableStaff(appContext, actor)
      : [],
    listRequestTypes(appContext, actor),
    getLocale(),
  ]);
  const filters = parseRequestFilters({
    searchParams,
    actor,
    company,
    companies,
    types,
    assignable,
  });
  const { internal, search, status, requested, showsCompany } = filters;
  const requests = await listRequests(appContext, actor, {
    search,
    status,
    company: company ?? filters.company,
    type: filters.type,
    priority: filters.priority,
    assignee: filters.assignee,
    ...requested,
  });

  const table = createPageUrl(path, filters.pageParams, await getTranslations('tables')).table(
    filters.definition,
    { ...requested, page: requests.page },
  );
  const canRaise = company
    ? companies.some(({ slug, canRaise: may }) => slug === company && may)
    : companies.some(({ canRaise: may }) => may);
  const newButton = canRaise && <NewRequestButton company={company} label={t('new')} />;
  // What an empty list says, and whether it invites a request: only where one would show up.
  const emptyKind = emptyKindOf(status, filters.narrowed);
  const names = { company: '', staff: settings.staffName };
  /**
   * The avatars of who a request is assigned to, each with its name on
   * hover. They sit in a copy of the row's link, above the link that covers
   * the row, so hovering one shows its name and clicking one still opens the
   * request; the copy is left out of the keyboard's and screen readers' way,
   * which get the names as text next to it.
   *
   * @param request - The request.
   * @returns The linked avatars.
   */
  const avatarsOf = (request: RequestListItem) => (
    <Link
      href={requestPath(request.number)}
      tabIndex={-1}
      aria-hidden="true"
      className="relative z-10 inline-flex w-fit"
    >
      <PeopleAvatars people={request.assignees} names={names} />
    </Link>
  );
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
      {renderHeader?.({ staffName: settings.staffName, canRaise })}
      <RequestFilterBar
        filters={filters}
        table={table}
        actor={actor}
        companies={companies}
        types={types}
        assignable={assignable}
        sortable={requests.total > 0}
      />

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
                {internal && (
                  <Th className="hidden whitespace-nowrap md:table-cell">
                    {t('columns.assignees')}
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
                const assigneeNames = request.assignees.map((person) => personName(person, names));
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
                          <span>{request.typeName}</span>
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
                          {internal && request.assignees.length > 0 && (
                            <>
                              {avatarsOf(request)}
                              <span className="sr-only">
                                {t('assignedToNames', { names: formatList(assigneeNames, locale) })}
                              </span>
                            </>
                          )}
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
                    {internal && (
                      <Td className="hidden md:table-cell">
                        {request.assignees.length > 0 ? (
                          <>
                            {avatarsOf(request)}
                            <span className="sr-only">{formatList(assigneeNames, locale)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{t('unassigned')}</span>
                          </span>
                        )}
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
