/**
 * @file A lane of the board of requests: its heading with its name and how
 * many requests it has, its cards, and a link to all of them in the list
 * when it holds more than it shows; while a card is dragged, whether it can
 * go there. Its text comes from `requests.board`.
 */
import { Ban, ChevronDown, MoveDown } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef } from 'react';

import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';
import type { RequestStatus } from '@/lib/requests';

import type { BoardDrag } from './board-drag';

/**
 * What a lane is while a card is dragged: the one it's in (`origin`), one it
 * may go to (`allowed`, or `target` while the pointer is over it), or one it
 * can't go to (`refused`).
 */
export type LaneDropState = 'origin' | 'allowed' | 'target' | 'refused';

/**
 * Props for {@link BoardLane}.
 */
interface BoardLaneProps {
  /** The lane's status. */
  status: RequestStatus;
  /** Its name, in the words of the reader's strongest part (`laneAudience`). */
  name: string;
  /** How many requests have its status, also those it doesn't show. */
  total: number;
  /** How many cards it shows. */
  shown: number;
  /** The list of all its requests, with the board's filters. */
  seeAllHref: string;
  /** Whether its cards are folded away, below tablet width. */
  collapsed: boolean;
  /** Folds its cards away or shows them again, below tablet width. */
  onToggle: () => void;
  /** What it is while a card is dragged; nothing while none is. */
  drop?: LaneDropState;
  /** The board's drag and drop, once it's loaded (from tablet width), to take cards with. */
  drag?: BoardDrag | null;
  /** Its cards (`BoardCard`s). */
  children: ReactNode;
}

/**
 * A lane: a section named by its heading, which says its name and how many
 * requests it has ("In progress, 12 requests" to screen readers). From
 * tablet width it's a column of the board's row, at least 15rem wide; below
 * that the lanes are stacked, and the heading is a button that folds the
 * lane's cards away and back (`aria-expanded`). The heading can take focus
 * from script (`data-card-heading`), where focus goes when a moved card isn't
 * on the board anymore (`restoreFocusIfLost`). An empty lane says so, and a
 * lane with more requests than it shows ends in "See all 132", a link to the
 * list of them with the board's filters.
 *
 * While a card is dragged (from tablet width), a lane it may go to has a
 * border in the highlight colour, and a ring and "Let go to move it here"
 * while the pointer is over it; a lane it can't go to has a dashed border,
 * the not-allowed cursor and says "Can't move here", so its colour is never
 * the only sign. Only the lanes it may go to take the card.
 *
 * @param props - Lane props.
 * @param props.status - The lane's status.
 * @param props.name - Its name.
 * @param props.total - How many requests it has.
 * @param props.shown - How many cards it shows.
 * @param props.seeAllHref - The list of all its requests.
 * @param props.collapsed - Whether its cards are folded away.
 * @param props.onToggle - Folds them away or shows them.
 * @param props.drop - What it is while a card is dragged.
 * @param props.drag - The board's drag and drop, once loaded.
 * @param props.children - Its cards.
 * @returns The lane.
 */
export default function BoardLane({
  status,
  name,
  total,
  shown,
  seeAllHref,
  collapsed,
  onToggle,
  drop = undefined,
  drag = null,
  children,
}: BoardLaneProps) {
  const t = useTranslations('requests.board');
  const headingId = useId();
  const cardsId = useId();
  const laneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = laneRef.current;
    if (!drag || !element) {
      return undefined;
    }
    return drag.lane({ element, lane: status });
  }, [drag, status]);
  const count = (
    <span
      aria-hidden="true"
      className="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-surface px-1.5 text-xs font-medium text-muted-foreground tabular-nums dark:bg-raised"
    >
      {total}
    </span>
  );
  const heading = t('laneHeading', { lane: name, count: total });

  return (
    <section
      ref={laneRef}
      aria-labelledby={headingId}
      // Where `restoreFocusIfLost` finds the heading, and the board finds the lane.
      data-card=""
      data-lane={status}
      // A step back from the cards in both modes: `muted` behind white cards, `surface` behind
      // `raised` ones in dark mode, where `surface` is the darker of the two.
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-muted p-2 transition-[border-color,box-shadow] md:min-w-60 md:flex-1 dark:bg-surface',
        !drop && 'border-border',
        drop === 'origin' && 'border-border',
        (drop === 'allowed' || drop === 'target') && 'border-highlight',
        // Inside its border: the lanes' row would cut off a ring drawn outside it.
        drop === 'target' && 'ring-2 ring-ring ring-inset',
        drop === 'refused' && 'cursor-not-allowed border-dashed border-border-strong',
      )}
    >
      <h2
        id={headingId}
        // Focusable from script only: when a moved card isn't on the board anymore.
        tabIndex={-1}
        data-card-heading=""
        className={cn('rounded-md text-sm font-semibold text-foreground', focusRing)}
      >
        {/* Below tablet width the heading folds the lane; from tablet width it's only text. */}
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
          {count}
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
          {count}
          <span className="sr-only">{heading}</span>
        </span>
      </h2>
      {drop === 'refused' && (
        <p className="flex items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2 py-1.5 text-sm font-medium text-foreground">
          <Ban aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {t('cantMoveHere')}
        </p>
      )}
      {drop === 'target' && (
        <p className="flex items-center gap-1.5 rounded-md border border-highlight px-2 py-1.5 text-sm font-medium text-foreground">
          <MoveDown aria-hidden="true" className="size-4 shrink-0 text-highlight" />
          {t('dropHere')}
        </p>
      )}
      <div id={cardsId} className={cn('flex flex-col gap-2', collapsed && 'max-md:hidden')}>
        {shown === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('emptyLane')}</p>
        ) : (
          <ul className="flex flex-col gap-2">{children}</ul>
        )}
        {total > shown && (
          <Link
            href={seeAllHref}
            className={cn(
              'inline-flex min-h-8 items-center justify-center rounded-md px-2 text-sm font-medium text-highlight hover:bg-surface hover:underline hover:underline-offset-4 dark:hover:bg-raised',
              focusRing,
            )}
          >
            <span aria-hidden="true">{t('seeAll', { count: total })}</span>
            <span className="sr-only">{t('seeAllLabel', { count: total, lane: name })}</span>
          </Link>
        )}
      </div>
    </section>
  );
}
