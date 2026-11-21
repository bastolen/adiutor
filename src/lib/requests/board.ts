/**
 * @file The rules of the board of requests: a lane per status, in the order
 * a request moves through them, and cards that move between lanes. Which
 * moves a reader may make comes from the server with each card (`moves`,
 * from `statusChoices`); these rules only order the lanes, word them, say
 * why a drop is refused, and place a moved card until the server confirms.
 * Free of server code, so the board's client components use them too.
 */
import type { RequestAudience } from './rules';
import { isClosedStatus, REQUEST_STATUSES, type RequestStatus } from './values';

/** Where the board is: next to the list of requests (`/requests`), with the same filters. */
export const BOARD_PATH = '/requests/board';

/** The board's lanes, one per status, in the order a request moves through them. */
export const BOARD_LANES: readonly RequestStatus[] = REQUEST_STATUSES;

/** How many cards a closed lane (Done, Cancelled) shows: its latest; the list has the rest. */
export const CLOSED_LANE_LIMIT = 10;

/**
 * Checks whether a lane holds closed requests, which show only their latest
 * cards ({@link CLOSED_LANE_LIMIT}).
 *
 * @param lane - The lane's status.
 * @returns Whether it does.
 */
export function isClosedLane(lane: RequestStatus): boolean {
  return isClosedStatus(lane);
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
