/**
 * @file The rules of the board of requests: a lane per status, in the order
 * a request moves through them, in five columns (Waiting and Closed each hold
 * two lanes, a half each), and cards that move between lanes. Which
 * moves a reader may make comes from the server with each card (`moves`,
 * from `statusChoices`); these rules only order the lanes, word them, say
 * why a drop is refused, and place a moved card until the server confirms.
 * Free of server code, so the board's client components use them too.
 */
import type { RequestAudience } from './rules';
import { REQUEST_STATUSES, type RequestStatus } from './values';

/** Where the board is: next to the list of requests (`/requests`), with the same filters. */
export const BOARD_PATH = '/requests/board';

/**
 * Where a company's board is below its page (`/companies/<URL name>/board`),
 * next to the company's list of requests, its first page.
 */
export const COMPANY_BOARD_SEGMENT = 'board';

/** The board's lanes, one per status, in the order a request moves through them. */
export const BOARD_LANES: readonly RequestStatus[] = REQUEST_STATUSES;

/**
 * How many cards a closed lane (Done, Cancelled, the halves of the Closed
 * column) shows: its latest; the list has the rest.
 */
export const CLOSED_LANE_LIMIT = 5;

/**
 * The statuses that share a column of the board, a half each, the upper
 * half first: Waiting (for the company, then for approval) and Closed (Done,
 * then Cancelled). Every other status is a column of its own.
 */
export const GROUPED_LANES = {
  waiting: ['waiting', 'proposed'],
  closed: ['done', 'cancelled'],
} as const satisfies Record<string, readonly [RequestStatus, RequestStatus]>;

/** A column of the board: a status's own, or one of {@link GROUPED_LANES}. */
export type BoardColumnKey =
  | Exclude<RequestStatus, 'waiting' | 'proposed' | 'done' | 'cancelled'>
  | keyof typeof GROUPED_LANES;

/** A column of the board, with its lanes: one, or the two halves of a grouped column. */
export interface BoardColumn<Lane> {
  /** The column: a status, or `waiting` / `closed` for a grouped one. */
  key: BoardColumnKey;
  /** Its lanes, the upper half first. */
  lanes: Lane[];
}

/**
 * The column a status's lane is in: its own, or the grouped column it's a
 * half of.
 *
 * @param status - The lane's status.
 * @returns The column's key.
 */
export function boardColumnOf(status: RequestStatus): BoardColumnKey {
  const grouped = (Object.keys(GROUPED_LANES) as (keyof typeof GROUPED_LANES)[]).find((key) =>
    (GROUPED_LANES[key] as readonly RequestStatus[]).includes(status),
  );
  return grouped ?? (status as BoardColumnKey);
}

/**
 * Groups the board's lanes into its columns, in the order of the lanes:
 * Open, To do and In progress each on their own, then Waiting and Closed,
 * each with two halves ({@link GROUPED_LANES}). The lanes stay what they
 * were (a status each, with its count and cards), so moving a card, its
 * counts and why a drop is refused all work per half.
 *
 * @param lanes - The lanes, in the board's order.
 * @returns The columns.
 */
export function boardColumns<Lane extends { status: RequestStatus }>(
  lanes: readonly Lane[],
): BoardColumn<Lane>[] {
  return lanes.reduce<BoardColumn<Lane>[]>((columns, lane) => {
    const key = boardColumnOf(lane.status);
    const column = columns.find((each) => each.key === key);
    if (column) {
      column.lanes.push(lane);
      return columns;
    }
    return [...columns, { key, lanes: [lane] }];
  }, []);
}

/** How strongly each audience takes part, to word a lane for the reader's strongest. */
const AUDIENCE_RANK: Record<RequestAudience, number> = { follower: 0, contributor: 1, staff: 2 };

/**
 * The audience a lane's title is worded for: the reader's strongest among
 * the companies on the board. A lane holds cards from several companies, and
 * someone may be a Client of one and a Watcher of another; a card whose own
 * audience differs says its status in its own words.
 *
 * @param audiences - The reader's audience on each card.
 * @returns The strongest, or `follower` for an empty board.
 */
export function laneAudience(audiences: readonly RequestAudience[]): RequestAudience {
  return audiences.reduce<RequestAudience>(
    (strongest, audience) =>
      AUDIENCE_RANK[audience] > AUDIENCE_RANK[strongest] ? audience : strongest,
    'follower',
  );
}

/** Why a card can't go to a lane, for the message a refused drop shows. */
export const MOVE_REFUSALS = [
  'readOnly',
  'proposedComesWithReply',
  'approveOnRequest',
  'staffSetsThat',
  'notFromHere',
] as const;

/** One of {@link MOVE_REFUSALS}. */
export type MoveRefusal = (typeof MOVE_REFUSALS)[number];

/**
 * Says why a card can't go to a lane, or nothing when it can (or stays where
 * it is). The server checks every move again; this only words a refusal:
 *
 * - `readOnly`: the reader moves no cards at all (a Watcher, Finance, a deactivated company);
 * - `proposedComesWithReply`: Waiting for approval comes only with a reply sent as the solution;
 * - `approveOnRequest`: someone at the company approves a solution on the request, not by moving it;
 * - `staffSetsThat`: the status is one only the staff set;
 * - `notFromHere`: any other move the card can't make from its lane (e.g. reopening an open one).
 *
 * @param card - The card.
 * @param card.status - The lane it's in.
 * @param card.moves - The lanes the reader may move it to.
 * @param card.audience - How the reader takes part in its company.
 * @param to - The lane it's dropped on.
 * @returns The reason, or `null` when the move is fine or there's nothing to move.
 */
export function moveRefusal(
  card: { status: RequestStatus; moves: readonly RequestStatus[]; audience: RequestAudience },
  to: RequestStatus,
): MoveRefusal | null {
  if (to === card.status || card.moves.includes(to)) {
    return null;
  }
  if (card.moves.length === 0) {
    return 'readOnly';
  }
  if (to === 'proposed') {
    return 'proposedComesWithReply';
  }
  if (card.status === 'proposed' && to === 'done' && card.audience !== 'staff') {
    return 'approveOnRequest';
  }
  if (card.audience !== 'staff') {
    return 'staffSetsThat';
  }
  return 'notFromHere';
}

/** A lane as the board holds it: its status, how many requests it has, and the cards it shows. */
export interface BoardLaneState<Card> {
  /** The lane's status. */
  status: RequestStatus;
  /** How many requests have that status, also those the lane doesn't show. */
  total: number;
  /** The cards it shows, in the board's sort. */
  items: Card[];
}

/**
 * Moves a card to another lane until the server confirms it: out of its
 * lane, onto the top of the new one (a move is activity, so under the
 * default sort it's the newest there), with both counts adjusted. A card
 * that isn't on the board, or a move to its own lane, leaves the lanes as
 * they are.
 *
 * @param lanes - The lanes.
 * @param cardId - The card's request ID.
 * @param to - The lane it moves to.
 * @returns The lanes after the move.
 */
export function placeMovedCard<Card extends { id: string; status: RequestStatus }>(
  lanes: readonly BoardLaneState<Card>[],
  cardId: string,
  to: RequestStatus,
): BoardLaneState<Card>[] {
  const card = lanes.flatMap(({ items }) => items).find(({ id }) => id === cardId);
  if (!card || card.status === to) {
    return [...lanes];
  }
  return lanes.map((lane) => {
    if (lane.status === card.status) {
      return {
        ...lane,
        total: Math.max(0, lane.total - 1),
        items: lane.items.filter(({ id }) => id !== cardId),
      };
    }
    if (lane.status === to) {
      return { ...lane, total: lane.total + 1, items: [{ ...card, status: to }, ...lane.items] };
    }
    return lane;
  });
}
