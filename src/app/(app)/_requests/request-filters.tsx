/**
 * @file What narrows a view of requests down, shared by the list and any
 * other view of the requests (the board): {@link parseRequestFilters} reads
 * the search, the filters and the table's sort from a page's query
 * parameters, and {@link RequestFilterBar} shows them as the status links,
 * the search form, the filter menus and the Sort menu. The text comes from
 * `requests.list`.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import FilterMenu from '@/components/ui/filter-menu';
import SearchForm from '@/components/ui/search-form';
import SegmentedNav from '@/components/ui/segmented-nav';
import SortMenu from '@/components/ui/sort-menu';
import TextLink from '@/components/ui/text-link';
import { companyChoiceLabels } from '@/lib/company-choices';
import {
  DEFAULT_REQUEST_STATUS_FILTER,
  INTERNAL_CHOICE,
  isRequestPriority,
  isRequestStatus,
  isRequestStatusFilter,
  mayBeAssigned,
  ONLY_STATUS_PARAM,
  type RequestAudience,
  type RequestPriority,
  REQUEST_PRIORITIES,
  REQUEST_STATUS_FILTERS,
  type RequestStatus,
  type RequestStatusFilter,
} from '@/lib/requests';
import { type SearchParams, searchParam } from '@/lib/search-params';
import type { TableLinks } from '@/lib/tables/page-url';
import { parseTableState, type TableDefinition, type TableState } from '@/lib/tables/table-state';
import { REQUESTS_TABLE, STAFF_REQUESTS_TABLE, type StaffRequestSort } from '@/lib/tables/tables';
import type { Actor } from '@/server/actor';
import { getInternalRequestPermissions, getStaffPermissionsInCompanies } from '@/server/authz';
import type { AssignableStaffMember, RequestCompany } from '@/server/requests';

import { StatusBadge } from './request-badges';

/** A request type as the filters need it: its key, its name and whether it's archived. */
interface FilterType {
  /** What requests hold, and the `type` parameter. */
  key: string;
  /** Its name. */
  name: string;
  /** Whether it's archived; archived types can still be filtered by. */
  archived: boolean;
}

/** What {@link parseRequestFilters} needs to read the filters. */
interface ParseRequestFiltersInput {
  /** The page's query parameters. */
  searchParams: SearchParams;
  /** The viewer. */
  actor: Actor;
  /** The company whose page this is (its URL name): the `company` parameter is ignored there. */
  company?: string;
  /** The companies the viewer sees requests of; a `company` parameter must be one of them. */
  companies: readonly Pick<RequestCompany, 'slug'>[];
  /** Every request type, archived ones too; a `type` parameter must be one of them. */
  types: readonly Pick<FilterType, 'key'>[];
  /** The staff who can be assigned, for the staff's `assignee` parameter; none for everyone else. */
  assignable: readonly Pick<AssignableStaffMember, 'id'>[];
}

/** The filters a view of requests is narrowed down by (see {@link parseRequestFilters}). */
export interface RequestFilters {
  /** Whether the viewer may see priorities and internal details (the staff). */
  internal: boolean;
  /** Whether the viewer may be assigned to requests, so `me` is an assignee they may filter by. */
  canBeAssigned: boolean;
  /** The text searched for, trimmed; empty for no search. */
  search: string;
  /** The status link the view is on. */
  status: RequestStatusFilter;
  /**
   * The one status the view shows instead (`?only=`), as a lane of the
   * board links to it; no status link is current then.
   */
  only: RequestStatus | undefined;
  /** How the viewer takes part, at most: the words a status is shown in when the view names one. */
  audience: RequestAudience;
  /** The key of the type filtered by, only when it's one the menu offers. */
  type: string | undefined;
  /** The priority filtered by; the staff only. */
  priority: RequestPriority | undefined;
  /** `me`, `none` or a staff member's ID, filtered by; the staff only. */
  assignee: string | undefined;
  /**
   * The URL name of the company chosen in the Company filter, or `INTERNAL_CHOICE` for the
   * internal requests; never set on a company's own page, and only for a company the viewer
   * sees (or the internal requests, for the staff).
   */
  company: string | undefined;
  /**
   * Whether the viewer reads internal requests (decision 0048), which the Company filter
   * offers as "Internal": the staff.
   */
  seesInternal: boolean;
  /**
   * Whether the Company filter is offered, and the rows name their company: not on a company's
   * page, with several to choose from ("Internal" counts as one).
   */
  showsCompany: boolean;
  /** The table that holds the requests: the staff's can also be sorted by priority. */
  definition: TableDefinition;
  /** The table's sort, direction, page and page size. */
  requested: TableState<StaffRequestSort>;
  /** Whether a search or one of the filter menus narrows the view down. */
  narrowed: boolean;
  /**
   * The page's own parameters in the order the search form submits them
   * (status, company, type, priority, assignee, then `q`), for
   * `createPageUrl`, so links and searches agree. Empty ones are left out.
   */
  pageParams: Record<string, string | undefined>;
}

/**
 * How the viewer takes part, at most: the words a status is shown in when a
 * view names one. The staff's, or the strongest a company reader takes part
 * in anywhere (an Admin or Client somewhere reads "Waiting for your reply").
 *
 * @param internal - Whether the viewer is the staff.
 * @param contributes - Whether they take part in requests in any company.
 */
function viewerAudience(internal: boolean, contributes: boolean): RequestAudience {
  if (internal) {
    return 'staff';
  }
  return contributes ? 'contributor' : 'follower';
}

/**
 * Reads a page's query parameters as the filters of a view of requests, and
 * drops what the viewer may not use: a priority and an assignee for anyone
 * but the staff, `me` for those who can't be assigned, a type no type has, a
 * company they don't see (and the internal requests, for anyone but the
 * staff), and the company parameter on a company's own page.
 * An invalid status falls back to the requests that are still worked on, and
 * the table's state is read as `parseTableState` does.
 *
 * @param input - What to read and check against.
 * @param input.searchParams - The page's query parameters.
 * @param input.actor - The viewer.
 * @param input.company - The company whose page this is, if any.
 * @param input.companies - The companies the viewer sees.
 * @param input.types - Every request type.
 * @param input.assignable - The staff who can be assigned.
 */
export function parseRequestFilters({
  searchParams,
  actor,
  company = undefined,
  companies,
  types,
  assignable,
}: ParseRequestFiltersInput): RequestFilters {
  const permissions = getStaffPermissionsInCompanies(actor);
  // The staff see priorities; everyone else gets none from the service either.
  const internal = permissions.has('requests:view-internal');
  // "Me" only for those who can be assigned; one staff member for the others.
  const canBeAssigned = mayBeAssigned(permissions);
  // One table, which the staff can also sort by priority.
  const definition: TableDefinition = internal ? STAFF_REQUESTS_TABLE : REQUESTS_TABLE;
  const search = searchParam(searchParams.q)?.trim() ?? '';
  const statusParam = searchParam(searchParams.status);
  const status = isRequestStatusFilter(statusParam) ? statusParam : DEFAULT_REQUEST_STATUS_FILTER;
  // One status instead of a status link's group, as a board's lane links to it.
  const onlyParam = searchParam(searchParams[ONLY_STATUS_PARAM]);
  const only = isRequestStatus(onlyParam) ? onlyParam : undefined;
  const priorityParam = searchParam(searchParams.priority);
  const priority = internal && isRequestPriority(priorityParam) ? priorityParam : undefined;
  const parsed = parseTableState(definition, searchParams);
  const requested: TableState<StaffRequestSort> = {
    ...parsed,
    // The table checked the sort against its own sorts; this only tells TypeScript which it is.
    sort: parsed.sort === 'raised' || parsed.sort === 'priority' ? parsed.sort : 'activity',
  };
  // A type to filter by only counts when it's one the menu offers: every type, archived ones too.
  const type = types.find(({ key }) => key === searchParam(searchParams.type))?.key;
  const assigneeParam = searchParam(searchParams.assignee);
  // An assignee to filter by only counts when it's one the menu offers.
  const assignee =
    internal &&
    (assigneeParam === 'none' ||
      (assigneeParam === 'me' && canBeAssigned) ||
      assignable.some(({ id }) => id === assigneeParam))
      ? assigneeParam
      : undefined;
  // The staff read internal requests, which the Company filter offers as a choice of its own.
  const seesInternal = getInternalRequestPermissions(actor).has('requests:view');
  // A company to filter by only counts when it's one the viewer sees.
  const companyParam = company ? undefined : searchParam(searchParams.company);
  const chosenCompany =
    seesInternal && companyParam === INTERNAL_CHOICE
      ? INTERNAL_CHOICE
      : companies.find(({ slug }) => slug === companyParam)?.slug;
  return {
    internal,
    canBeAssigned,
    search,
    status,
    only,
    audience: viewerAudience(internal, permissions.has('requests:contribute')),
    type,
    priority,
    assignee,
    company: chosenCompany,
    seesInternal,
    showsCompany: !company && companies.length + (seesInternal ? 1 : 0) > 1,
    definition,
    requested,
    narrowed: Boolean(search || only || chosenCompany || type || priority || assignee),
    pageParams: {
      status: only || status === DEFAULT_REQUEST_STATUS_FILTER ? undefined : status,
      [ONLY_STATUS_PARAM]: only,
      company: chosenCompany,
      type,
      priority,
      assignee,
      q: search,
    },
  };
}

/**
 * The page's own parameters without the ones that pick statuses (the status
 * link and `?only=`): what the List and Board views share, since the board
 * has a lane per status instead, and what its links to the list start from.
 *
 * @param filters - The filters ({@link parseRequestFilters}).
 * @returns The parameters, for `createPageUrl`.
 */
export function viewParams(filters: RequestFilters): Record<string, string | undefined> {
  return { ...filters.pageParams, status: undefined, [ONLY_STATUS_PARAM]: undefined };
}

/**
 * Props for {@link RequestFilterBar}.
 */
interface RequestFilterBarProps {
  /** The filters ({@link parseRequestFilters}). */
  filters: RequestFilters;
  /**
   * The links of the table the view's requests are in, built with
   * `createPageUrl` from `filters.pageParams`: they keep the filters and
   * the table's state.
   */
  table: TableLinks<string>;
  /** The viewer: the staff's assignee menu names them "Me" instead of by name. */
  actor: Actor;
  /** The companies the viewer sees requests of, for the Company filter. */
  companies: readonly RequestCompany[];
  /** Every request type, for the Type filter. */
  types: readonly FilterType[];
  /** The staff who can be assigned, for the staff's Assignee filter. */
  assignable: readonly AssignableStaffMember[];
  /** Whether to show the status links; the board has a lane per status instead. Defaults to yes. */
  showStatusTabs?: boolean;
  /** Whether there are requests to sort, which shows the Sort menu. Defaults to yes. */
  sortable?: boolean;
  /** One more control, shown after the filter menus and the Sort menu. */
  children?: ReactNode;
}

/**
 * The controls that narrow a view of requests down: a row of status links
 * (unless left out), a search by title or number, and menus for the company
 * (when there's more than one to choose from), the type and, for the staff,
 * the priority and the assignee (Me, for those who can be assigned, Not
 * assigned, or one staff member), next to the Sort menu and whatever else
 * the view adds as children.
 */
export function RequestFilterBar({
  filters,
  table,
  actor,
  companies,
  types,
  assignable,
  showStatusTabs = true,
  sortable = true,
  children = undefined,
}: RequestFilterBarProps) {
  const t = useTranslations('requests.list');
  const tRequests = useTranslations('requests');
  const tCommon = useTranslations('common');
  const { internal, canBeAssigned, search, status, only, type, priority, assignee } = filters;
  /**
   * The options of a filter menu: "all" first (no value for the parameter),
   * then one per item, each linking to the view with that value, and the
   * chosen one marked as the current one.
   *
   * @param param - The query parameter the menu filters by.
   * @param allLabel - The text of the option that removes the filter.
   * @param chosen - The value the view is filtered by now, if any.
   * @param items - The values to choose from, with their labels.
   */
  const filterOptions = (
    param: 'company' | 'type' | 'priority' | 'assignee',
    allLabel: string,
    chosen: string | undefined,
    items: { value: string; label: string }[],
  ) => [
    {
      value: '',
      label: allLabel,
      href: table.withParams({ [param]: undefined }),
      current: !chosen,
    },
    ...items.map(({ value, label }) => ({
      value,
      label,
      href: table.withParams({ [param]: value }),
      current: value === chosen,
    })),
  ];
  // The filters in the order the search form submits them; the search is its own field.
  const kept = Object.entries(filters.pageParams).filter(
    (entry): entry is [string, string] => entry[0] !== 'q' && entry[1] !== undefined,
  );

  return (
    <div className="flex flex-col gap-4">
      {showStatusTabs && (
        <SegmentedNav
          label={t('statusLabel')}
          items={REQUEST_STATUS_FILTERS.map((value) => ({
            href: table.withParams({
              status: value === DEFAULT_REQUEST_STATUS_FILTER ? undefined : value,
              [ONLY_STATUS_PARAM]: undefined,
            }),
            label: t('statusOption', { status: value }),
            current: !only && value === status,
          }))}
        />
      )}
      {showStatusTabs && only && (
        // The one status the view shows, in the viewer's words, and the way back to the links.
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t('onlyStatus')}</span>
          <StatusBadge status={only} audience={filters.audience} />
          <TextLink href={table.withParams({ [ONLY_STATUS_PARAM]: undefined })}>
            {t('everyStatus')}
          </TextLink>
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchForm
          id="request-search"
          label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          defaultValue={search}
          hiddenFields={{
            ...Object.fromEntries(kept),
            ...table.hiddenFields(),
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {filters.showsCompany && (
            <FilterMenu
              label={t('companyFilter')}
              menuLabel={t('companyMenu')}
              options={filterOptions('company', t('allCompanies'), filters.company, [
                // The staff's own requests, which have no company, come first.
                ...(filters.seesInternal
                  ? [{ value: INTERNAL_CHOICE, label: tRequests('internal.label') }]
                  : []),
                ...companyChoiceLabels(companies, ({ name, slug }) =>
                  tCommon('companyWithUrlName', { name, urlName: slug }),
                ).map(({ slug, label }) => ({ value: slug, label })),
              ])}
            />
          )}
          <FilterMenu
            label={t('typeFilter')}
            menuLabel={t('typeMenu')}
            options={filterOptions(
              'type',
              t('allTypes'),
              type,
              types.map(({ key, name, archived }) => ({
                value: key,
                label: archived ? t('archivedType', { name }) : name,
              })),
            )}
          />
          {internal && (
            <FilterMenu
              label={t('priorityFilter')}
              menuLabel={t('priorityMenu')}
              options={filterOptions(
                'priority',
                t('allPriorities'),
                priority,
                REQUEST_PRIORITIES.map((value) => ({
                  value,
                  label: tRequests('priority', { priority: value }),
                })),
              )}
            />
          )}
          {internal && (
            <FilterMenu
              label={t('assigneeFilter')}
              menuLabel={t('assigneeMenu')}
              options={filterOptions('assignee', t('anyAssignee'), assignee, [
                ...(canBeAssigned ? [{ value: 'me', label: t('assignedToMe') }] : []),
                { value: 'none', label: t('unassigned') },
                // The viewer is "Me" already.
                ...assignable
                  .filter(({ id }) => !canBeAssigned || id !== actor.id)
                  .map(({ id, name }) => ({
                    value: id,
                    label: name ?? tRequests('controls.unnamedStaff'),
                  })),
              ])}
            />
          )}
          {sortable && <SortMenu label={t('rows')} options={table.sortOptions()} />}
          {children}
        </div>
      </div>
    </div>
  );
}
