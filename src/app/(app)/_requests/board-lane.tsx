'use client';

/**
 * @file A column of the board of requests: one lane (Open, To do, In
 * progress), or the two halves of Waiting and Closed, each half a lane of its
 * own. A lane is a group with a heading with its name and how many requests
 * it has, its cards (a list that says when it shows fewer than the lane
 * holds), and a link to all of them in the list when it holds more than it
 * shows; while a card is dragged, it says whether the card can go there. Its
 * text comes from `requests.board`.
 */
import { Ban, ChevronDown, MoveDown } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef } from 'react';

import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';
import { type BoardColumnKey, isClosedStatus, type RequestStatus } from '@/lib/requests';

import type { BoardDrag } from './board-drag';

/**
 * What a lane is while a card is dragged: the one it's in (`origin`), one it
 * may go to (`allowed`, or `target` while the pointer is over it), or one it
 * can't go to (`refused`).
 */
export type LaneDropState = 'origin' | 'allowed' | 'target' | 'refused';

/** A lane as its column shows it: a whole column's, or a half of a grouped one. */
export interface ColumnLane {
  /** Its status. */
  status: RequestStatus;
  /** Its name, in the words of the reader's strongest part (`laneAudience`). */
  name: string;
  /** How many requests have its status, also those it doesn't show. */
  total: number;
  /** How many cards it shows. */
  shown: number;
  /** The list of all its requests, with the board's filters. */
  seeAllHref: string;
  /** What it is while a card is dragged; nothing while none is. */
  drop?: LaneDropState;
  /** Its cards (`BoardCard`s). */
  cards: ReactNode;
}

/**
 * The classes of a lane while a card is dragged: a border in the highlight
 * colour where the card may go (and a ring under the pointer), a dashed one
 * and the not-allowed cursor where it can't.
 *
 * @param drop - What the lane is while a card is dragged.
 * @returns The classes.
 */
function dropClasses(drop: LaneDropState | undefined): string {
  return cn(
    'transition-[border-color,box-shadow]',
    (!drop || drop === 'origin') && 'border-border',
    (drop === 'allowed' || drop === 'target') && 'border-highlight',
    // Inside its border: the lanes' row would cut off a ring drawn outside it.
    drop === 'target' && 'ring-2 ring-ring ring-inset',
    drop === 'refused' && 'cursor-not-allowed border-dashed border-border-strong',
  );
}

/**
 * Makes a lane take the cards that may go to it, while the board's drag and
 * drop is loaded.
 *
 * @param drag - The board's drag and drop, or `null`.
 * @param status - The lane's status; `null` for a column of halves, which takes no cards itself.
 * @returns The ref for the lane's element.
 */
function useLaneDrop(drag: BoardDrag | null, status: RequestStatus | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!drag || !element || !status) {
      return undefined;
    }
    return drag.lane({ element, lane: status });
  }, [drag, status]);
  return ref;
}

/**
 * How many requests a lane or column has, as a small round count, written
 * in the reader's language ("1,234", "1.234") like the number in the
 * sentence next to it, which screen readers hear instead (a heading's, or a
 * button's in the row that jumps to a column).
 *
 * @param props - Component props.
 * @param props.total - The count.
 * @returns The count.
 */
export function LaneCount({ total }: { total: number }) {
  const t = useTranslations('requests.board');
  return (
    <span
      aria-hidden="true"
      className="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-surface px-1.5 text-xs font-medium text-muted-foreground tabular-nums dark:bg-raised"
    >
      {t('laneCount', { count: total })}
    </span>
  );
}

/**
 * What a lane says while a card is dragged: "Can't move here" where it can't
 * go, and under the pointer where it may, what letting go does ("Let go to
 * mark it as done", "Let go to cancel it", "Let go to move it here").
 *
 * @param props - Component props.
 * @param props.drop - What the lane is while a card is dragged.
 * @param props.status - The lane's status.
 * @returns The line, or nothing.
 */
function DropNote({ drop, status }: { drop: LaneDropState | undefined; status: RequestStatus }) {
  const t = useTranslations('requests.board');
  if (drop === 'refused') {
    return (
      <p className="flex items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2 py-1.5 text-sm font-medium text-foreground">
        <Ban aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {t('cantMoveHere')}
      </p>
    );
  }
  if (drop === 'target') {
    return (
      <p className="flex items-center gap-1.5 rounded-md border border-highlight px-2 py-1.5 text-sm font-medium text-foreground">
        <MoveDown aria-hidden="true" className="size-4 shrink-0 text-highlight" />
        {t('dropHere', { status })}
      </p>
    );
  }
  return null;
}

/**
 * A lane's cards, or that it has none, and "See all 132" when it holds more
 * than it shows: a link to the list of them with the board's filters. A
 * lane that shows fewer cards than it holds says so in its list's name, which
 * screen readers say with the list ("First 25 of 80" for an open lane in the
 * list's sort, "Latest 5 of 132" for a closed one), so the heading's count and
 * the cards they hear don't seem to disagree.
 *
 * @param props - Component props.
 * @param props.lane - The lane.
 * @returns The cards.
 */
function LaneCards({ lane }: { lane: ColumnLane }) {
  const t = useTranslations('requests.board');
  const partial = lane.total > lane.shown;
  return (
    <>
      {lane.shown === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('emptyLane')}</p>
      ) : (
        <ul
          aria-label={
            partial
              ? t('shownCards', {
                  order: isClosedStatus(lane.status) ? 'latest' : 'first',
                  shown: lane.shown,
                  total: lane.total,
                })
              : undefined
          }
          className="flex flex-col gap-2"
        >
          {lane.cards}
        </ul>
      )}
      {partial && (
        <Link
          href={lane.seeAllHref}
          className={cn(
            'inline-flex min-h-8 items-center justify-center rounded-md px-2 text-sm font-medium text-highlight hover:bg-surface hover:underline hover:underline-offset-4 dark:hover:bg-raised',
            focusRing,
          )}
        >
          <span aria-hidden="true">{t('seeAll', { count: lane.total })}</span>
          <span className="sr-only">
            {t('seeAllLabel', { count: lane.total, lane: lane.name })}
          </span>
        </Link>
      )}
    </>
  );
}

/**
 * A half of a grouped column (Waiting for the company above Waiting for
 * approval, Done above Cancelled): a lane of its own, a group named by its
 * heading ("Done, 2 requests" to screen readers), which takes the cards that
 * may go to it and can take focus from script, like a whole lane's.
 *
 * @param props - Component props.
 * @param props.lane - The lane.
 * @param props.drag - The board's drag and drop, once loaded.
 * @returns The half.
 */
function LaneHalf({ lane, drag }: { lane: ColumnLane; drag: BoardDrag | null }) {
  const t = useTranslations('requests.board');
  const headingId = useId();
  const ref = useLaneDrop(drag, lane.status);
  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={headingId}
      // Where `restoreFocusIfLost` finds the heading, and the board finds the lane.
      data-card=""
      data-lane={lane.status}
      className={cn('flex flex-col gap-2 rounded-lg border p-2', dropClasses(lane.drop))}
    >
      <h3
        id={headingId}
        // Focusable from script only: when a moved card isn't on the board anymore.
        tabIndex={-1}
        data-card-heading=""
        className={cn(
          'flex min-h-7 items-center gap-2 rounded-md px-1 text-sm font-medium text-foreground',
          focusRing,
        )}
      >
        <span aria-hidden="true" className="min-w-0 flex-1 wrap-anywhere">
          {lane.name}
        </span>
        <LaneCount total={lane.total} />
        <span className="sr-only">{t('laneHeading', { lane: lane.name, count: lane.total })}</span>
      </h3>
      <DropNote drop={lane.drop} status={lane.status} />
      <LaneCards lane={lane} />
    </div>
  );
}

/**
 * Props for {@link BoardColumn}.
 */
interface BoardColumnProps {
  /** The column: a status, or `waiting` / `closed` for a grouped one. */
  column: BoardColumnKey;
  /** Its name: its lane's, or "Waiting" / "Closed". */
  name: string;
  /** Its lanes: one, or its two halves, the upper first. */
  lanes: ColumnLane[];
  /** Whether its cards are folded away, below tablet width. */
  collapsed: boolean;
  /** Folds its cards away or shows them again, below tablet width. */
  onToggle: () => void;
  /** The board's drag and drop, once it's loaded (from tablet width), to take cards with. */
  drag?: BoardDrag | null;
}

/**
 * A column of the board: a group named by its heading, which says its
 * name and how many requests it has ("In progress, 12 requests", "Closed, 9
 * requests" to screen readers). It's a group, not a section: a named section
 * is a landmark, and the columns and their halves would make about nine of
 * them, crowding the page's landmarks; the headings stay for moving through
 * the board by heading. From tablet width it sits in the board's
 * row, at least 14rem wide (all five fit side by side on a wide screen);
 * below that the columns are stacked, and the
 * heading is a button that folds the column away and back (`aria-expanded`),
 * both halves of a grouped column together. The heading can take focus from
 * script (`data-card-heading`), where focus goes when a moved card isn't on
 * the board anymore (`restoreFocusIfLost`).
 *
 * A column of one lane is that lane: it takes the cards that may go to it.
 * Waiting and Closed hold two halves, each a lane with its own heading,
 * count, cards, "See all" and empty text (`LaneHalf`), and each takes cards
 * on its own: a card dropped on Done's half is marked as done, one dropped
 * on Cancelled's is cancelled, and Waiting for approval's never takes one.
 *
 * While a card is dragged (from tablet width), a lane it may go to has a
 * border in the highlight colour, and a ring and what letting go does while
 * the pointer is over it; a lane it can't go to has a dashed border, the
 * not-allowed cursor and says "Can't move here", so its colour is never the
 * only sign.
 *
 * @returns The column.
 */
export default function BoardColumn({
  column,
  name,
  lanes,
  collapsed,
  onToggle,
  drag = null,
}: BoardColumnProps) {
  const t = useTranslations('requests.board');
  const headingId = useId();
  const cardsId = useId();
  const [only] = lanes.length === 1 ? lanes : [];
  const ref = useLaneDrop(drag, only?.status ?? null);
  const total = lanes.reduce((sum, lane) => sum + lane.total, 0);
  const heading = t('laneHeading', { lane: name, count: total });

  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={headingId}
      // Where `restoreFocusIfLost` finds the heading, and the board finds the lane and column.
      data-card=""
      data-lane={only?.status}
      data-column={column}
      // A step back from the cards in both modes: `muted` behind white cards, `surface` behind
      // `raised` ones in dark mode, where `surface` is the darker of the two.
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-muted p-2 md:min-w-56 md:flex-1 dark:bg-surface',
        dropClasses(only?.drop),
      )}
    >
      <h2
        id={headingId}
        // Focusable from script only: when a moved card isn't on the board anymore.
        tabIndex={-1}
        data-card-heading=""
        className={cn('rounded-md text-sm font-semibold text-foreground', focusRing)}
      >
        {/* Below tablet width the heading folds the column; from tablet width it's only text. */}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={cardsId}
          onClick={onToggle}
          className={cn(
            'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-surface md:hidden dark:hover:bg-raised',
            focusRing,
          )}
        >
          <span aria-hidden="true" className="min-w-0 flex-1 wrap-anywhere">
            {name}
          </span>
          <LaneCount total={total} />
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              collapsed && '-rotate-90',
            )}
          />
          <span className="sr-only">{heading}</span>
        </button>
        <span className="hidden min-h-8 items-center gap-2 px-1 md:flex">
          <span aria-hidden="true" className="min-w-0 flex-1 wrap-anywhere">
            {name}
          </span>
          <LaneCount total={total} />
          <span className="sr-only">{heading}</span>
        </span>
      </h2>
      {only && <DropNote drop={only.drop} status={only.status} />}
      <div id={cardsId} className={cn('flex flex-col gap-2', collapsed && 'max-md:hidden')}>
        {only ? (
          <LaneCards lane={only} />
        ) : (
          lanes.map((lane) => <LaneHalf key={lane.status} lane={lane} drag={drag} />)
        )}
      </div>
    </div>
  );
}
