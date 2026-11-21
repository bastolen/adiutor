/**
 * @file The board of requests: a lane per status, each with the requests of
 * that status the reader may see, filtered as the list is
 * (`requestListCondition`), and each card with the lanes the reader may move
 * it to. The open lanes show the first cards in the list's sort; Done and
 * Cancelled their latest {@link CLOSED_LANE_LIMIT}, the rest being in the
 * list. Every lane also says how many requests it has. How it works is in
 * [Requests](../../../docs/requests.md#the-board).
 */
import { desc, eq, inArray, lte, type SQL, sql } from 'drizzle-orm';

import { company, request, requestType } from '@/db/schema';
import { getPermissions } from '@/lib/authz/permissions';
import {
  ACTIVE_REQUEST_STATUSES,
  BOARD_LANES,
  CLOSED_LANE_LIMIT,
  CLOSED_REQUEST_STATUSES,
  type RequestStatus,
  statusChoices,
} from '@/lib/requests';
import type { TableState } from '@/lib/tables/table-state';
import type { StaffRequestSort } from '@/lib/tables/tables';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import {
  type ListRequestsOptions,
  loadRequestListItems,
  requestListColumns,
  requestListCondition,
  type RequestListItem,
  type RequestListRow,
  requestListOrder,
  requestTableState,
} from './list';

/** A card on the board: a request as the list shows it, and the lanes the reader may move it to. */
export interface BoardCard extends RequestListItem {
  /**
   * The statuses the reader may give it (`statusChoices` with their
   * permissions in its company); none in a deactivated company, or for a
   * reader who only reads. The browser never gets the permissions.
   */
  moves: RequestStatus[];
}

/** One lane of the board. */
export interface BoardLane {
  /** Its status. */
  status: RequestStatus;
  /** How many requests have that status, also those the lane doesn't show. */
  total: number;
  /** The cards it shows, in the board's sort (Done and Cancelled: newest first). */
  items: BoardCard[];
}

/**
 * What narrows the board down: the list's filters, its sort and direction,
 * and how many cards an open lane shows (`size`, one of the list's page
 * sizes). The list's status group, single status and page mean nothing here.
 */
export type ListBoardOptions = Omit<ListRequestsOptions, 'status' | 'only' | 'page'> &
  Partial<Pick<TableState<StaffRequestSort>, 'size'>>;

/**
 * Picks the cards of some lanes: per status, the first `limit` requests in
 * `order`, and how many requests each status has. One query, numbered and
 * counted per status by a window, so a lane never holds more than its limit
 * and still knows its total.
 *
 * @param ctx - Service context.
 * @param where - The requests the reader may see, filtered (on `request` joined with `company`).
 * @param order - The order inside each lane, ending with the request's ID.
 * @param limit - How many cards a lane shows.
 * @returns The picked requests' IDs, statuses and their status's total, in order within each status.
 */
async function pickCards(
  ctx: ServiceContext,
  where: SQL | undefined,
  order: SQL[],
  limit: number,
): Promise<{ id: string; status: RequestStatus; total: number }[]> {
  const ranked = ctx.db
    .select({
      id: request.id,
      status: request.status,
      rank: sql<number>`row_number() over (partition by ${request.status} order by ${sql.join(order, sql`, `)})`.as(
        'lane_rank',
      ),
      total: sql<string>`count(*) over (partition by ${request.status})`.as('lane_total'),
    })
    .from(request)
    .innerJoin(company, eq(request.companyId, company.id))
    .where(where)
    .as('ranked');
  const rows = await ctx.db
    .select({ id: ranked.id, status: ranked.status, total: ranked.total })
    .from(ranked)
    .where(lte(ranked.rank, limit))
    .orderBy(ranked.status, ranked.rank);
  // Postgres counts in a bigint, which arrives as text.
  return rows.map((row) => ({ ...row, total: Number(row.total) }));
}

/**
 * The lanes the reader may move a card to: `statusChoices` with their
 * permissions in its company, and none while the company is deactivated
 * (its requests can only be read, also by the staff, who keep their rights
 * there).
 *
 * @param actor - The reader.
 * @param row - The card's request, as selected.
 * @returns The statuses.
 */
function movesOf(actor: Actor, row: RequestListRow): RequestStatus[] {
  if (row.companyDeactivatedAt !== null) {
    return [];
  }
  const permissions = getPermissions({
    platformRole: actor.platformRole,
    companyRole: actor.memberships[row.company.id] ?? null,
    company: { deactivated: false },
  });
  return statusChoices(permissions, row.status);
}

/**
 * Loads the board for the reader: every lane ({@link BOARD_LANES}), with the
 * requests they may see of its status, filtered and sorted as the list is.
 * An open lane shows up to `size` cards (the list's page sizes, 25 by
 * default); Done and Cancelled show their latest {@link CLOSED_LANE_LIMIT}
 * by last activity, whatever the sort (closing a request is activity).
 * Across companies, the open lanes leave out a deactivated company's
 * requests, as the list's Active view does; the closed lanes keep them, as
 * Closed does. Readers who don't see priorities get none, and can't filter
 * or sort by them.
 *
 * Each card says which lanes the reader may move it to (`moves`); every move
 * still goes through `changeRequestStatus`, which checks it again.
 *
 * Three queries, whatever the size: the open lanes, the closed lanes (each
 * picked and counted per status in one windowed query) and the cards' rows,
 * plus who they're assigned to.
 *
 * @param ctx - Service context.
 * @param actor - The reader.
 * @param options - The list's filters, the sort, and the open lanes' size.
 * @returns The lanes, in order, and the size the open lanes use.
 * @throws {ServiceError} `not_found` for a company the reader may not see.
 */
export async function listBoard(
  ctx: ServiceContext,
  actor: Actor,
  options: ListBoardOptions = {},
): Promise<{ lanes: BoardLane[]; size: number }> {
  const { search, company: companyRef, type, priority, assignee, ...table } = options;
  const state = requestTableState(actor, table);
  const filters = { search, company: companyRef, type, priority, assignee };
  const [whereOpen, whereClosed] = await Promise.all([
    requestListCondition(ctx, actor, { ...filters, statuses: ACTIVE_REQUEST_STATUSES }),
    requestListCondition(ctx, actor, { ...filters, statuses: CLOSED_REQUEST_STATUSES }),
  ]);
  const [open, closed] = await Promise.all([
    pickCards(ctx, whereOpen, requestListOrder(state), state.size),
    pickCards(
      ctx,
      whereClosed,
      [desc(request.lastActivityAt), desc(request.id)],
      CLOSED_LANE_LIMIT,
    ),
  ]);
  const picked = [...open, ...closed];
  const rows =
    picked.length === 0
      ? []
      : await ctx.db
          .select(requestListColumns)
          .from(request)
          .innerJoin(company, eq(request.companyId, company.id))
          .innerJoin(requestType, eq(request.type, requestType.key))
          .where(
            inArray(
              request.id,
              picked.map(({ id }) => id),
            ),
          );
  const moves = new Map(rows.map((row) => [row.id, movesOf(actor, row)]));
  const items = new Map(
    (await loadRequestListItems(ctx, actor, rows)).map((item) => [item.id, item]),
  );

  const lanes = BOARD_LANES.map((status): BoardLane => {
    const inLane = picked.filter((card) => card.status === status);
    return {
      status,
      total: inLane[0]?.total ?? 0,
      items: inLane.flatMap(({ id }) => {
        const item = items.get(id);
        // A request whose status changed between the two queries waits for the next load.
        return item?.status === status ? [{ ...item, moves: moves.get(id) ?? [] }] : [];
      }),
    };
  });
  return { lanes, size: state.size };
}
