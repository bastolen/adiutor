/**
 * @file The browser part of the board of requests: the lanes in a row that
 * scrolls sideways (stacked below tablet width), and moving cards between
 * them with each card's Move menu, which places the card in its new lane at
 * once and puts it where the server says once the move is saved. Its text
 * comes from `requests.board` and `requests.controls`, which the board's page
 * passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from 'react';

import Alert from '@/components/ui/alert';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import restoreFocusIfLost, { focusIsLost, isShown } from '@/components/ui/focus-fallback';
import { focusRing } from '@/components/ui/styles';
import { useToast } from '@/components/ui/toast';
import { useTransientState } from '@/components/ui/use-transient-state';
import cn from '@/lib/cn';
import { type BoardLaneState, placeMovedCard, type RequestStatus } from '@/lib/requests';

import { moveRequestAction } from './board-actions';
import BoardCard, { type BoardCardView } from './board-card';
import BoardLane from './board-lane';

/** A move that asks first: to Done or Cancelled. */
interface ConfirmedMove {
  card: BoardCardView;
  to: 'done' | 'cancelled';
}

/** What the board shows: its lanes, and the cards being moved (busy until the server answers). */
interface ShownBoard {
  /** The lanes, with every move under way already made. */
  lanes: BoardLaneState<BoardCardView>[];
  /** The request IDs of the cards being moved. */
  moving: readonly string[];
}

/**
 * Checks whether a move asks first: to Done or Cancelled, like the request
 * page's Cancel. A move emails everyone on the request.
 *
 * @param to - The lane.
 * @returns Whether it does.
 */
function asksFirst(to: RequestStatus): to is ConfirmedMove['to'] {
  return to === 'done' || to === 'cancelled';
}

/**
 * Finds a card's Move button on the board, wherever its lane is shown.
 *
 * @param root - The board.
 * @param id - The card's request ID.
 * @returns The button, or `null` when the card isn't on the board (or its lane is folded away).
 */
function moveButtonOf(root: HTMLElement | null, id: string): HTMLElement | null {
  return (
    Array.from(root?.querySelectorAll<HTMLElement>('[data-request]') ?? []).find(
      (button) => button.dataset.request === id && isShown(button),
    ) ?? null
  );
}

/**
 * Finds a lane on the board.
 *
 * @param root - The board.
 * @param status - The lane's status.
 * @returns The lane's section, or `null`.
 */
function laneOf(root: HTMLElement | null, status: RequestStatus): HTMLElement | null {
  return (
    Array.from(root?.querySelectorAll<HTMLElement>('[data-lane]') ?? []).find(
      (lane) => lane.dataset.lane === status,
    ) ?? null
  );
}

/**
 * Props for {@link Board}.
 */
interface BoardProps {
  /** The lanes as the server has them, in order. */
  lanes: BoardLaneState<BoardCardView>[];
  /** Each lane's name, in the words of the reader's strongest part. */
  names: Readonly<Record<RequestStatus, string>>;
  /** Each lane's link to the list of all its requests, with the board's filters. */
  seeAll: Readonly<Record<RequestStatus, string>>;
}

/**
 * The lanes, each with its cards, and what moving one takes:
 *
 * - **The row:** from tablet width the lanes sit side by side in a box that
 *   scrolls sideways, named "Lanes", which the keyboard reaches (`tabIndex`)
 *   and scrolls with the arrow keys while it overflows, as a wide code block
 *   does; the page itself never scrolls sideways. Below tablet width they're
 *   stacked, and each folds away.
 * - **Moving:** a card's Move menu lists the lanes it may go to. Done and
 *   Cancelled ask first (`ConfirmDialog`). The card moves to the top of its
 *   new lane at once (`useOptimistic` with `placeMovedCard`, counts too) and
 *   is busy there, alone, until the server answers; then the board shows the
 *   lanes as they are. Several moves may run at once.
 * - **The outcome:** a toast says the card moved; a refusal shows above the
 *   lanes and as a toast (`Alert`'s `alsoToast`), and the card goes back,
 *   or, when someone changed the request meanwhile, to where it is now.
 * - **Focus:** the card's Move button is removed and added again as the card
 *   changes lanes, so focus follows it: to its Move button in the new lane
 *   (found by its `data-request` once the change is on screen), or, when the
 *   card isn't on the board anymore (past the lane's size), to its lane's
 *   heading (`restoreFocusIfLost`). Focus is only moved when it would
 *   otherwise be lost.
 *
 * The error, the open dialog and the folded lanes reset when the reader
 * leaves the page (`useTransientState`), and the busy cards when the moves
 * end.
 *
 * @param props - Board props.
 * @param props.lanes - The lanes as the server has them.
 * @param props.names - Each lane's name.
 * @param props.seeAll - Each lane's link to all its requests.
 * @returns The board.
 */
export default function Board({ lanes, names, seeAll }: BoardProps) {
  const t = useTranslations('requests.board');
  const tControls = useTranslations('requests.controls');
  const showToast = useToast();
  const [pending, startTransition] = useTransition();
  const saved = useMemo<ShownBoard>(() => ({ lanes, moving: [] }), [lanes]);
  const [shown, showMove] = useOptimistic(
    saved,
    (current: ShownBoard, move: { card: BoardCardView; to: RequestStatus }) => ({
      lanes: placeMovedCard(current.lanes, move.card.id, move.to),
      moving: [...current.moving, move.card.id],
    }),
  );
  const [error, setError] = useTransientState<string | null>(null);
  // The move that asks first, kept while its dialog closes so its words stay.
  const [asked, setAsked] = useTransientState<ConfirmedMove | null>(null);
  const [confirming, setConfirming] = useTransientState(false);
  // The lanes folded away below tablet width.
  const [folded, setFolded] = useTransientState<ReadonlySet<RequestStatus>>(new Set());
  // Whether the row is wider than its box, so the keyboard needs to reach it to scroll it.
  const [scrolls, setScrolls] = useState(true);
  const boardRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // The card focus follows after a move, and the lane it went to, until the moves end.
  const following = useRef<{ id: string; lane: RequestStatus } | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      setScrolls(row.scrollWidth > row.clientWidth);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  /**
   * Puts focus on a card's Move button when focus is lost, e.g. because the
   * button it was on went with its card to another lane.
   *
   * @param id - The card's request ID.
   * @returns Whether focus is on the card's button, or wasn't lost.
   */
  const focusCard = useCallback((id: string) => {
    if (!focusIsLost()) {
      return true;
    }
    const button = moveButtonOf(boardRef.current, id);
    button?.focus();
    return button !== null;
  }, []);

  // After every change on screen while a card is followed: its button gets focus when focus was
  // lost, and once the moves have ended and the card isn't on the board, its lane's heading does.
  useLayoutEffect(() => {
    const target = following.current;
    if (!target) {
      return;
    }
    if (!focusCard(target.id) && !pending) {
      restoreFocusIfLost(laneOf(boardRef.current, target.lane));
    }
    if (!pending) {
      following.current = null;
    }
  });

  /**
   * Moves a card: places it in its new lane at once, saves the move from the
   * lane the board showed it in, and says how it went.
   *
   * @param card - The card.
   * @param to - The lane it goes to.
   */
  const move = (card: BoardCardView, to: RequestStatus) => {
    setError(null);
    following.current = { id: card.id, lane: to };
    // Below tablet width, a lane that's folded away opens to show the card arrive.
    setFolded((current) => new Set([...current].filter((lane) => lane !== to)));
    startTransition(async () => {
      showMove({ card, to });
      const result = await moveRequestAction({
        request: card.number,
        status: to,
        from: card.status,
      });
      if (!result.ok) {
        setError(result.message);
      } else if (showToast && result.message) {
        showToast(result.message, { tone: 'success' });
      }
    });
  };

  /**
   * Starts a move the reader picked in a card's Move menu: Done and
   * Cancelled ask first.
   *
   * @param card - The card.
   * @param to - The lane.
   */
  const choose = (card: BoardCardView, to: RequestStatus) => {
    if (asksFirst(to)) {
      setAsked({ card, to });
      setConfirming(true);
      return;
    }
    move(card, to);
  };

  return (
    <div ref={boardRef} className="flex flex-col gap-4">
      <Alert tone="error" alsoToast onDismiss={() => setError(null)}>
        {error}
      </Alert>
      <div
        ref={rowRef}
        role="group"
        aria-label={t('lanes')}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A box that scrolls must be reachable with the keyboard to be scrolled with it (WCAG 2.1.1).
        tabIndex={scrolls ? 0 : undefined}
        // `relative`: what's positioned inside (the text only screen readers get) is placed, and
        // cut off, in the row's box, so it never stretches the page sideways.
        className={cn('relative rounded-xl md:overflow-x-auto', focusRing)}
      >
        <div className="flex flex-col gap-4 md:flex-row md:gap-3">
          {shown.lanes.map((lane) => (
            <BoardLane
              key={lane.status}
              status={lane.status}
              name={names[lane.status]}
              total={lane.total}
              shown={lane.items.length}
              seeAllHref={seeAll[lane.status]}
              collapsed={folded.has(lane.status)}
              onToggle={() =>
                setFolded((current) => {
                  const next = new Set(current);
                  if (!next.delete(lane.status)) {
                    next.add(lane.status);
                  }
                  return next;
                })
              }
            >
              {lane.items.map((card) => (
                <BoardCard
                  key={card.id}
                  card={card}
                  names={names}
                  busy={shown.moving.includes(card.id)}
                  onChoose={choose}
                />
              ))}
            </BoardLane>
          ))}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        onCloseAutoFocus={(event) => {
          // Back on the card's Move button: in its lane after Cancel, in its new lane after a move.
          event.preventDefault();
          if (asked) {
            focusCard(asked.card.id);
          }
        }}
        title={asked ? t('confirmTitle', { to: asked.to, reference: asked.card.reference }) : ''}
        description={asked?.to === 'done' ? t('doneDescription') : tControls('cancelDescription')}
        confirmLabel={asked?.to === 'done' ? tControls('markDone') : tControls('cancel')}
        // "Cancel" next to "Cancel request" would say nothing.
        cancelLabel={asked?.to === 'done' ? undefined : tControls('keep')}
        tone="primary"
        onConfirm={() => {
          if (asked) {
            move(asked.card, asked.to);
          }
        }}
      />
    </div>
  );
}
