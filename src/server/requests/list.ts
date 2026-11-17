/**
 * @file Lists of requests: the companies someone sees requests of, and the
 * requests themselves, across companies or in one, one page at a time.
 */
import { and, count, eq, ilike, inArray, isNull, like, or, type SQL, sql } from 'drizzle-orm';

import { company, request, user } from '@/db/schema';
import { getPermissions } from '@/lib/authz/permissions';
import { firstRow } from '@/lib/defined';
import {
  DEFAULT_REQUEST_STATUS_FILTER,
  isRequestPriority,
  isRequestStatusFilter,
  isRequestType,
  REQUEST_PRIORITIES,
  type RequestAudience,
  requestNumberStartInSearch,
  type RequestPriority,
  type RequestStatus,
  type RequestStatusFilter,
  type RequestType,
  statusesOfFilter,
} from '@/lib/requests';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { REQUESTS_TABLE, STAFF_REQUESTS_TABLE, type StaffRequestSort } from '@/lib/tables/tables';

import { getCompanyAccess } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { notFoundError } from '../errors';
import { orderTerms, paginate, textOrder } from '../pagination';
import getRequestPrefix from '../people/request-prefix';
import getStaffName from '../people/staff-name';
import containsPattern from '../search';
import {
  requestAudienceIn,
  type RequestPerson,
  requestPerson,
  requestScope,
  visibleRequests,
} from './access';

/** A company whose requests someone sees. */
export interface RequestCompany {
  /** The company's ID. */
  id: string;
  /** Its name. */
  name: string;
  /** Its URL name. */
  slug: string;
  /** Whether it's deactivated: its requests can then only be read. */
  deactivated: boolean;
  /** Whether they may raise a request in it. */
  canRaise: boolean;
}

/**
 * Lists the companies whose requests the actor sees, by name: every company
 * for the staff, their active companies for everyone else. It's what a
 * request list filters by, and what a new request is raised in.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @returns The companies; empty for someone in no company.
 */
export async function listRequestCompanies(
  ctx: ServiceContext,
  actor: Actor,
): Promise<RequestCompany[]> {
  const scope = requestScope(actor);
  if (!scope.everyCompany && scope.memberOf.length === 0) {
    return [];
  }
  const rows = await ctx.db
    .select({
      id: company.id,
      name: company.name,
      slug: company.slug,
      deactivatedAt: company.deactivatedAt,
    })
    .from(company)
    .where(
      scope.everyCompany
        ? undefined
        : and(inArray(company.id, scope.memberOf), isNull(company.deactivatedAt)),
    )
    .orderBy(...orderTerms('asc', textOrder(company.name), company.id));
  return rows.map(({ deactivatedAt, ...row }) => {
    const deactivated = deactivatedAt !== null;
    const permissions = getPermissions({
      platformRole: actor.platformRole,
      companyRole: actor.memberships[row.id] ?? null,
      company: { deactivated },
    });
    // The staff keep their rights in a deactivated company, but its requests are read-only.
    return {
      ...row,
      deactivated,
      canRaise: !deactivated && permissions.has('requests:contribute'),
    };
  });
}

/** What {@link listRequests} can be asked for: filters, a search, and the table's sort and page. */
export interface ListRequestsOptions extends Partial<TableState<StaffRequestSort>> {
  /** Text to match against the title, or a request's number ("AD-142", "142"). */
  search?: string;
  /** A status filter (`REQUEST_STATUS_FILTERS`); anything else shows the requests that are still worked on. */
  status?: string;
  /** One company's requests only: its ID or URL name. */
  company?: string;
  /** One type only (`REQUEST_TYPES`); anything else shows every type. */
  type?: string;
  /** One priority only (`REQUEST_PRIORITIES`), for those who see priorities; ignored otherwise. */
  priority?: string;
}

/** A request in a list. */
export interface RequestListItem {
  /** The request's ID. */
  id: string;
  /** Its number. */
  number: number;
  /** Its title. */
  title: string;
  /** Its status. */
  status: RequestStatus;
  /** Whether it was done or cancelled before and is open again. */
  reopened: boolean;
  /** Its type. */
  type: RequestType;
  /** Its priority, or `null` for readers who don't see priorities. */
  priority: RequestPriority | null;
  /** Its company. */
  company: { id: string; name: string; slug: string };
  /** Who raised it. */
  raisedBy: RequestPerson;
  /** When it was raised. */
  createdAt: Date;
  /** When it was raised, replied to or changed last. */
  lastActivityAt: Date;
  /**
   * How to address the reader about it: as the staff, as someone who takes
   * part in its company, or as a follower there. The same as on the
   * request's own page (`RequestDetail.audience`).
   */
  audience: RequestAudience;
}

/** A request's priority as a number, lowest first, to sort by. */
const PRIORITY_RANK = sql`case ${request.priority} ${sql.join(
  REQUEST_PRIORITIES.map((priority, rank) => sql`when ${priority} then ${rank}`),
  sql` `,
)} end`;

/**
 * The ORDER BY terms of a request list.
 *
 * @param state - The table's state.
 * @returns The terms, ending with the request's ID.
 */
function requestOrder(state: TableState<StaffRequestSort>): SQL[] {
  switch (state.sort) {
    case 'raised':
      return orderTerms(state.dir, request.createdAt, request.id);
    case 'priority':
      return orderTerms(state.dir, PRIORITY_RANK, request.id);
    default:
      return orderTerms(state.dir, request.lastActivityAt, request.id);
  }
}

/**
 * The condition of a search: the title contains the term, or the term is a
 * number that the request's number starts with ("AD-1" finds 1, 10 to 19,
 * 100 and up), so a number narrows the list as it's typed, like a title.
 *
 * @param term - The search term, trimmed and not empty.
 * @returns The condition.
 */
function matchesSearch(term: string): SQL | undefined {
  const inTitle = ilike(request.title, containsPattern(term));
  const digits = requestNumberStartInSearch(term);
  if (digits === null) {
    return inTitle;
  }
  // Only digits, so nothing in it means anything to LIKE. The title search reads every row
  // the filters leave anyway, so comparing the number as text costs nothing more.
  return or(like(sql`${request.number}::text`, `${digits}%`), inTitle);
}

/**
 * Lists the requests the actor sees, one page at a time: every company's for
 * the staff, their active companies' for everyone else, or one company's.
 * By default the requests that are still worked on, the one with the latest
 * activity first.
 *
 * Across companies, the requests of a deactivated company are left out of
 * the lists of what's still worked on (`active`, `waiting`): nobody can work
 * on them. They're in the other lists and in the company's own.
 *
 * Readers who don't see priorities get none, and can't filter or sort by
 * them: asking for it changes nothing.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param options - Filters, search, sort and page.
 * @returns The page of requests.
 * @throws {ServiceError} `not_found` when asked for a company the actor may not see.
 */
export async function listRequests(
  ctx: ServiceContext,
  actor: Actor,
  options: ListRequestsOptions = {},
): Promise<Paged<RequestListItem>> {
  const scope = requestScope(actor);
  const { search = '', status, company: companyRef, type, priority, ...table } = options;
  const state: TableState<StaffRequestSort> = scope.internal
    ? resolveTableState(STAFF_REQUESTS_TABLE, table)
    : resolveTableState(REQUESTS_TABLE, {
        ...table,
        sort: table.sort === 'priority' ? undefined : table.sort,
      });
  const filter: RequestStatusFilter = isRequestStatusFilter(status)
    ? status
    : DEFAULT_REQUEST_STATUS_FILTER;

  const conditions: (SQL | undefined)[] = [visibleRequests(scope)];
  if (companyRef) {
    const access = await getCompanyAccess(ctx.db, actor, companyRef);
    if (!access.permissions.has('requests:view')) {
      throw notFoundError();
    }
    conditions.push(eq(request.companyId, access.company.id));
  } else if (filter === 'active' || filter === 'waiting') {
    conditions.push(isNull(company.deactivatedAt));
  }
  const statuses = statusesOfFilter(filter);
  if (statuses) {
    conditions.push(inArray(request.status, [...statuses]));
  }
  if (isRequestType(type)) {
    conditions.push(eq(request.type, type));
  }
  if (scope.internal && isRequestPriority(priority)) {
    conditions.push(eq(request.priority, priority));
  }
  const term = search.trim();
  if (term) {
    conditions.push(matchesSearch(term));
  }
  const where = and(...conditions);
  const order = requestOrder(state);

  const page = await paginate(
    state,
    async () =>
      firstRow(
        await ctx.db
          .select({ total: count() })
          .from(request)
          .innerJoin(company, eq(request.companyId, company.id))
          .where(where),
        'the request count',
      ).total,
    (limit, offset) =>
      ctx.db
        .select({
          id: request.id,
          number: request.number,
          title: request.title,
          status: request.status,
          reopenedAt: request.reopenedAt,
          type: request.type,
          priority: request.priority,
          createdAt: request.createdAt,
          lastActivityAt: request.lastActivityAt,
          createdBySide: request.createdBySide,
          company: { id: company.id, name: company.name, slug: company.slug },
          companyDeactivatedAt: company.deactivatedAt,
          author: { id: user.id, name: user.name },
        })
        .from(request)
        .innerJoin(company, eq(request.companyId, company.id))
        .leftJoin(user, eq(request.createdBy, user.id))
        .where(where)
        .orderBy(...order)
        .limit(limit)
        .offset(offset),
  );
  return {
    ...page,
    items: page.items.map(
      ({ author, createdBySide, reopenedAt, companyDeactivatedAt, ...row }) => ({
        ...row,
        reopened: reopenedAt !== null,
        priority: scope.internal ? row.priority : null,
        raisedBy: requestPerson(author ?? { id: null, name: null }, createdBySide, actor),
        // Per company: someone can take part in one and only follow another.
        audience: requestAudienceIn(actor, {
          id: row.company.id,
          deactivatedAt: companyDeactivatedAt,
        }),
      }),
    ),
  };
}

/**
 * Loads what every request page shows that the staff chose: the prefix of
 * request numbers and the name the staff are shown with. Nothing here is
 * about one request or one person.
 *
 * @param ctx - Service context.
 * @returns The prefix, e.g. "AD", and the staff's name, e.g. "Adiutor".
 */
export async function getRequestSettings(
  ctx: Pick<ServiceContext, 'db'>,
): Promise<{ prefix: string; staffName: string }> {
  const [prefix, staffName] = await Promise.all([getRequestPrefix(ctx.db), getStaffName(ctx.db)]);
  return { prefix, staffName };
}
