/**
 * @file Dragging cards between the board's lanes, with Pragmatic drag and
 * drop: the one file that imports it (`src/client-imports.test.ts` checks
 * this). The board loads it with `import()` once the page is there, and only
 * from tablet width, so the library is never part of the page's own
 * JavaScript and phones, which move cards with the Move menu, never load it.
 *
 * It only wires the browser's drag and drop to the board: which card is
 * dragged, which lane the pointer is over, and where it's dropped. What a
 * move means (allowed, refused, asked first) is the board's own business
 * (`board.tsx`), as is everything people see and hear.
 */
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { getElementFromPointWithoutHoneypot } from '@atlaskit/pragmatic-drag-and-drop/get-element-from-point-without-honey-pot';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';

import { isRequestStatus, type RequestStatus } from '@/lib/requests';

/** What a dragged card carries: its request and where it may go. */
export interface DraggedCard {
  /** The request's ID. */
  id: string;
  /** The lane it's in. */
  status: RequestStatus;
  /** The lanes it may go to. */
  moves: RequestStatus[];
}

/** Where a dragged card was let go. */
export interface CardDrop {
  /** The lane that took it: one it may go to, under the pointer. `null` when none did. */
  accepted: RequestStatus | null;
  /** The lane under the pointer, whether it took the card or not; `null` between lanes. */
  under: RequestStatus | null;
}

/** What the board hears of a drag. */
export interface BoardDragEvents {
  /**
   * A card was picked up.
   *
   * @param card - The card.
   */
  onStart: (card: DraggedCard) => void;
  /**
   * The pointer moved over another lane, or off every lane.
   *
   * @param lane - The lane, or `null`.
   */
  onOver: (lane: RequestStatus | null) => void;
  /**
   * The card was let go (also when the drag was given up, e.g. with Escape).
   *
   * @param card - The card.
   * @param drop - Where it was let go.
   */
  onDrop: (card: DraggedCard, drop: CardDrop) => void;
}

/** Cleans up what a function here set up. */
type Cleanup = () => void;

/** What the board gets from this file once it's loaded. */
export interface BoardDrag {
  /**
   * Makes a card draggable by its grip.
   *
   * @param args - The card.
   * @param args.element - The card's element, which the browser drags.
   * @param args.handle - Its grip, where a drag starts.
   * @param args.card - The card's request and moves, read when a drag starts; `null` while it
   *   can't be dragged (it's being moved).
   * @param args.onDraggingChange - Called when its drag starts and ends.
   * @returns What undoes it.
   */
  card: (args: {
    element: HTMLElement;
    handle: HTMLElement;
    card: () => DraggedCard | null;
    onDraggingChange: (dragging: boolean) => void;
  }) => Cleanup;
  /**
   * Makes a lane take the cards that may go to it. A lane a card may not go
   * to doesn't take it, so the browser shows that it can't be dropped there.
   *
   * @param args - The lane.
   * @param args.element - The lane's element.
   * @param args.lane - Its status.
   * @returns What undoes it.
   */
  lane: (args: { element: HTMLElement; lane: RequestStatus }) => Cleanup;
  /**
   * Follows every drag on the board, and scrolls the lanes' row sideways
   * while a card is dragged near its edges.
   *
   * @param args - What to follow.
   * @param args.row - The lanes' row, which scrolls sideways.
   * @param args.events - What the board hears.
   * @returns What undoes it.
   */
  watch: (args: { row: HTMLElement; events: BoardDragEvents }) => Cleanup;
}

/**
 * Reads a dragged card from a drag's data, which any element on the page
 * could have started.
 *
 * @param data - The drag's data.
 * @returns The card, or `null` when it isn't one.
 */
export function draggedCard(data: Record<string | symbol, unknown>): DraggedCard | null {
  const { id, status, moves } = data;
  if (
    typeof id !== 'string' ||
    !isRequestStatus(status) ||
    !Array.isArray(moves) ||
    !moves.every(isRequestStatus)
  ) {
    return null;
  }
  return { id, status, moves };
}

/**
 * The lane under a point of the screen. The library puts an element of its
 * own under the pointer around a drop (its "honey pot", which keeps hover
 * styles from flashing), so that one is looked through.
 *
 * @param x - The point's distance from the left, in pixels.
 * @param y - Its distance from the top.
 * @returns The lane's status, or `null` when there's no lane there.
 */
function laneAt(x: number, y: number): RequestStatus | null {
  const lane = getElementFromPointWithoutHoneypot({ x, y })?.closest<HTMLElement>('[data-lane]')
    ?.dataset.lane;
  return isRequestStatus(lane) ? lane : null;
}

/**
 * Makes a card draggable by its grip (see {@link BoardDrag.card}).
 *
 * @param args - The card.
 * @param args.element - The card's element, which the browser drags.
 * @param args.handle - Its grip, where a drag starts.
 * @param args.card - The card's request and moves; `null` while it can't be dragged.
 * @param args.onDraggingChange - Called when its drag starts and ends.
 * @returns What undoes it.
 */
const card: BoardDrag['card'] = ({ element, handle, card: current, onDraggingChange }) =>
  draggable({
    element,
    dragHandle: handle,
    /**
     * Lets a drag start only while the card can be moved.
     *
     * @returns Whether it can.
     */
    canDrag: () => current() !== null,
    /**
     * The card's request and moves, which the drag carries.
     *
     * @returns The drag's data.
     */
    getInitialData: () => ({ ...current() }),
    /** Tells the card its drag started. */
    onDragStart: () => {
      onDraggingChange(true);
    },
    /** Tells the card its drag ended. */
    onDrop: () => {
      onDraggingChange(false);
    },
  });

/**
 * Makes a lane take the cards that may go to it (see {@link BoardDrag.lane}).
 *
 * @param args - The lane.
 * @param args.element - The lane's element.
 * @param args.lane - Its status.
 * @returns What undoes it.
 */
const lane: BoardDrag['lane'] = ({ element, lane: status }) =>
  dropTargetForElements({
    element,
    /**
     * Names the lane, for the drop.
     *
     * @returns The lane's data.
     */
    getData: () => ({ lane: status }),
    /**
     * Takes only a card that may go to the lane.
     *
     * @param feedback - The drag.
     * @param feedback.source - What's dragged.
     * @returns Whether the lane takes it.
     */
    canDrop: ({ source }) => draggedCard(source.data)?.moves.includes(status) ?? false,
  });

/**
 * Follows every drag on the board and scrolls the lanes' row (see
 * {@link BoardDrag.watch}).
 *
 * @param args - What to follow.
 * @param args.row - The lanes' row, which scrolls sideways.
 * @param args.events - What the board hears.
 * @returns What undoes it.
 */
const watch: BoardDrag['watch'] = ({ row, events }) => {
  // The lane the board was last told the pointer is over, so it hears only of a change.
  let over: RequestStatus | null = null;
  // The lane under the pointer at the last `dragover`, which the browser sends with every move,
  // also over a lane that doesn't take the card: where a drop no lane took was let go.
  let lastUnder: RequestStatus | null = null;
  /**
   * Notes the lane under the pointer as the card is dragged.
   *
   * @param event - The browser's `dragover`.
   */
  const noteLane = (event: DragEvent) => {
    lastUnder = laneAt(event.clientX, event.clientY);
  };
  window.addEventListener('dragover', noteLane, { capture: true });
  const stopWatching = monitorForElements({
    /**
     * Follows only the board's cards.
     *
     * @param feedback - The drag.
     * @param feedback.source - What's dragged.
     * @returns Whether it's a card.
     */
    canMonitor: ({ source }) => draggedCard(source.data) !== null,
    /**
     * Tells the board a card was picked up.
     *
     * @param payload - The drag.
     * @param payload.source - What's dragged.
     * @param payload.location - Where the pointer is.
     */
    onDragStart: ({ source, location }) => {
      const dragged = draggedCard(source.data);
      if (dragged) {
        over = laneAt(location.current.input.clientX, location.current.input.clientY);
        lastUnder = over;
        events.onStart(dragged);
      }
    },
    /**
     * Tells the board when the pointer is over another lane.
     *
     * @param payload - The drag.
     * @param payload.location - Where the pointer is.
     */
    onDrag: ({ location }) => {
      const under = laneAt(location.current.input.clientX, location.current.input.clientY);
      if (under !== over) {
        over = under;
        events.onOver(under);
      }
    },
    /**
     * Tells the board where the card was let go.
     *
     * @param payload - The drag.
     * @param payload.source - What's dragged.
     * @param payload.location - Where the pointer is, and the lane that took it.
     */
    onDrop: ({ source, location }) => {
      const dragged = draggedCard(source.data);
      // Where the pointer was last seen during the drag: a drop no lane took ends like a drag
      // given up, whose last position the browser doesn't always report.
      const under = lastUnder;
      over = null;
      lastUnder = null;
      if (!dragged) {
        return;
      }
      const accepted = location.current.dropTargets[0]?.data.lane;
      events.onDrop(dragged, { accepted: isRequestStatus(accepted) ? accepted : null, under });
    },
  });
  const stopScrolling = autoScrollForElements({
    element: row,
    /**
     * Scrolls only for the board's cards.
     *
     * @param feedback - The drag.
     * @param feedback.source - What's dragged.
     * @returns Whether to scroll.
     */
    canScroll: ({ source }) => draggedCard(source.data) !== null,
    /**
     * Scrolls the row sideways only: the page scrolls up and down by itself.
     *
     * @returns The axis.
     */
    getAllowedAxis: () => 'horizontal',
  });
  return () => {
    window.removeEventListener('dragover', noteLane, { capture: true });
    stopWatching();
    stopScrolling();
  };
};

/** The board's drag and drop, for `board.tsx`. */
const boardDrag: BoardDrag = { card, lane, watch };

export default boardDrag;
