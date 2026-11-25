/**
 * @file A card on the board of requests: what the server rendered of its
 * request (`BoardCardView.body` and `meta`), with its Move menu and, from
 * tablet width, a grip to drag it by. Its text is the Move menu's
 * (`requests.board`).
 */
import { GripVertical } from 'lucide-react';
import { type ReactNode, useEffect, useEffectEvent, useRef } from 'react';

import { useTransientState } from '@/components/ui/use-transient-state';
import cn from '@/lib/cn';
import type { RequestAudience, RequestStatus } from '@/lib/requests';

import type { BoardDrag } from './board-drag';
import MoveMenu from './move-menu';

/** A card as the board's browser part gets it: what it needs to move it, and what to show. */
export interface BoardCardView {
  /** The request's ID. */
  id: string;
  /** Its number, which a move names. */
  number: number;
  /** Its number as people see it ("AD-142"). */
  reference: string;
  /** Its status: the lane it's in. */
  status: RequestStatus;
  /** The lanes the reader may move it to; none for a card they only read. */
  moves: RequestStatus[];
  /** How the reader takes part in its company, for why a drop is refused (`moveRefusal`). */
  audience: RequestAudience;
  /**
   * What the card says, rendered on the server: its number, type and title
   * (a link stretched over the card), and its priority, company and labels
   * where they apply.
   */
  body: ReactNode;
  /** Its footer, rendered on the server: who it's assigned to and its last activity. */
  meta: ReactNode;
}

/**
 * Props for {@link BoardCard}.
 */
interface BoardCardProps {
  /** The card. */
  card: BoardCardView;
  /** Each lane's name, for the Move menu. */
  names: Readonly<Record<RequestStatus, string>>;
  /** Whether it's being moved. */
  busy: boolean;
  /**
   * The board's drag and drop, once it's loaded (from tablet width);
   * `null` before and below, where the Move menu is the only way to move.
   */
  drag: BoardDrag | null;
  /**
   * Called with the lane the reader picked in the Move menu.
   *
   * @param card - The card.
   * @param to - The lane.
   */
  onChoose: (card: BoardCardView, to: RequestStatus) => void;
}

/**
 * One card: its content, and below it its footer next to the Move menu
 * (none for a card the reader can't move). The whole card is one click
 * target for the request, through the title's stretched link; the Move
 * button, the avatars and the grip sit above it. While it's being moved, its
 * Move button is busy (`aria-busy`), and the board's live region says so to
 * screen readers ("Moving AD-142 to In progress…"): a status added to the card already
 * filled in would often go unread.
 *
 * Once the board's drag and drop has loaded, a card the reader may move
 * gets a grip in its top corner (`cursor-grab`), which drags it. The grip is
 * decorative (`aria-hidden`): the Move menu is the way to move a card with
 * the keyboard, a screen reader or a single tap (WCAG 2.5.7). While it's
 * dragged, the card left behind shows its place with a dashed border; it
 * can't be dragged while it's being moved.
 *
 * @returns The card, as a list item.
 */
export default function BoardCard({ card, names, busy, drag, onChoose }: BoardCardProps) {
  const cardRef = useRef<HTMLLIElement>(null);
  const gripRef = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useTransientState(false);
  const movable = card.moves.length > 0;
  // Read when a drag starts, so it's always the card as it is now; none while it's being moved.
  const dragged = useEffectEvent(() =>
    busy ? null : { id: card.id, status: card.status, moves: card.moves },
  );

  useEffect(() => {
    const element = cardRef.current;
    const handle = gripRef.current;
    if (!drag || !element || !handle) {
      return undefined;
    }
    return drag.card({
      element,
      handle,
      /**
       * The card as it is when a drag starts.
       *
       * @returns Its request and moves, or `null` while it's being moved.
       */
      card: () => dragged(),
      onDraggingChange: setDragging,
    });
  }, [drag, movable, setDragging]);

  return (
    <li
      ref={cardRef}
      className={cn(
        'group relative flex flex-col gap-3 rounded-lg border bg-surface p-3 shadow-xs transition-colors dark:bg-raised',
        // The place a dragged card leaves: dashed and flat, its text as it was.
        dragging
          ? 'border-dashed border-border-strong bg-muted shadow-none dark:bg-surface'
          : 'border-border hover:border-border-strong',
      )}
    >
      {card.body}
      {drag && movable && (
        <span
          ref={gripRef}
          aria-hidden="true"
          data-drag-handle={card.id}
          className="absolute top-2 right-2 z-10 hidden size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing md:flex dark:hover:bg-raised-muted"
        >
          <GripVertical className="size-4" />
        </span>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {card.meta}
        {movable && (
          <MoveMenu
            id={card.id}
            reference={card.reference}
            moves={card.moves}
            names={names}
            busy={busy}
            onChoose={(to) => onChoose(card, to)}
          />
        )}
      </div>
    </li>
  );
}
