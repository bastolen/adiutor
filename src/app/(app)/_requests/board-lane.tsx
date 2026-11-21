/**
 * @file A lane of the board of requests: its heading with its name and how
 * many requests it has, its cards, and a link to all of them in the list
 * when it holds more than it shows. Its text comes from `requests.board`.
 */
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';

import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';
import type { RequestStatus } from '@/lib/requests';

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
 * @param props - Lane props.
 * @param props.status - The lane's status.
 * @param props.name - Its name.
 * @param props.total - How many requests it has.
 * @param props.shown - How many cards it shows.
 * @param props.seeAllHref - The list of all its requests.
 * @param props.collapsed - Whether its cards are folded away.
 * @param props.onToggle - Folds them away or shows them.
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
  children,
}: BoardLaneProps) {
  const t = useTranslations('requests.board');
  const headingId = useId();
  const cardsId = useId();
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
      aria-labelledby={headingId}
      // Where `restoreFocusIfLost` finds the heading, and the board finds the lane.
      data-card=""
      data-lane={status}
      // A step back from the cards in both modes: `muted` behind white cards, `surface` behind
      // `raised` ones in dark mode, where `surface` is the darker of the two.
      className="flex flex-col gap-3 rounded-xl border border-border bg-muted p-2 md:min-w-60 md:flex-1 dark:bg-surface"
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
