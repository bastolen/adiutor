'use client';

/**
 * @file The row of buttons above the board's lanes that jumps to a column:
 * one per column, with its count, shown from tablet width while the lanes
 * don't all fit side by side. A press scrolls the lanes' row to the column
 * and moves the focus to its heading. Its text comes from `requests.board`.
 */
import { useTranslations } from 'next-intl';
import { type RefObject, useId, useLayoutEffect, useRef } from 'react';

import Button from '@/components/ui/button';
import restoreFocusIfLost, { focusIsLost, isShown } from '@/components/ui/focus-fallback';
import type { BoardColumnKey } from '@/lib/requests';

import { LaneCount } from './board-lane';

/** The media query for someone who asked for less motion, who gets no smooth scrolling. */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** A column as the row names it. */
export interface JumpColumn {
  /** The column: a status, or `waiting` / `closed` for a grouped one. */
  key: BoardColumnKey;
  /** Its name, as its heading says it. */
  name: string;
  /** How many requests it has, both halves of a grouped column together. */
  total: number;
}

/**
 * Checks whether the reader asked for less motion.
 *
 * @returns Whether they did.
 */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/**
 * Scrolls the lanes' row so a column starts at its left edge (as far as the
 * row goes), smoothly unless the reader asked for less motion, and puts the
 * focus on the column's heading (`data-card-heading`, focusable from script)
 * without scrolling anything else. Only the row scrolls: the page stays
 * where it is, with the row just below the buttons.
 *
 * @param row - The lanes' row.
 * @param key - The column.
 */
function jumpToColumn(row: HTMLElement | null, key: BoardColumnKey): void {
  const column = row?.querySelector<HTMLElement>(`[data-column="${key}"]`);
  // The column's own heading comes before its halves' headings.
  const heading = column?.querySelector<HTMLElement>('[data-card-heading]');
  if (!row || !column || !heading) {
    return;
  }
  const offset =
    column.getBoundingClientRect().left - row.getBoundingClientRect().left - row.clientLeft;
  row.scrollTo({
    left: row.scrollLeft + offset,
    behavior: prefersReducedMotion() ? 'instant' : 'smooth',
  });
  heading.focus({ preventScroll: true });
}

/**
 * Props for {@link BoardLaneJump}.
 */
interface BoardLaneJumpProps {
  /** The board's columns, in order, with the counts the board shows now. */
  columns: readonly JumpColumn[];
  /** The lanes' row, which scrolls sideways. */
  row: RefObject<HTMLElement | null>;
}

/**
 * A navigation named "Jump to a lane" by its visible label, with a button
 * per column (Open, To do, In progress, Waiting, Closed) that says its name
 * and count ("In progress, 12 requests" to screen readers, like the
 * column's heading); a press scrolls to the column and focuses its heading
 * ({@link jumpToColumn}).
 *
 * It's shown from tablet width (below it the lanes are stacked) while the
 * board is narrower than its five columns side by side, which is when their
 * row scrolls: 5 × 14rem (`md:min-w-56` on a column) and 4 × 0.75rem
 * (`md:gap-3` between them), 73rem of the board's own width, a container
 * (`@container`). It's CSS, not a measurement, so the row is in the page
 * from the server's first paint and the lanes never shift down once the page
 * runs; change the 73rem with the columns' width or gap.
 *
 * When the board comes to fit (a wider window) and hides the row while focus
 * is in it, focus moves to the main content rather than `<body>`.
 */
export default function BoardLaneJump({ columns, row }: BoardLaneJumpProps) {
  const t = useTranslations('requests.board');
  const labelId = useId();
  const navRef = useRef<HTMLElement>(null);
  // Whether focus is in the row, or was until it went nowhere in particular (the row hid).
  const hadFocus = useRef(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    // Its box goes when the container query hides it.
    const observer = new ResizeObserver(() => {
      if (!isShown(nav) && hadFocus.current && focusIsLost()) {
        hadFocus.current = false;
        restoreFocusIfLost(nav);
      }
    });
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navRef}
      aria-labelledby={labelId}
      onFocus={() => {
        hadFocus.current = true;
      }}
      onBlur={(event) => {
        // Focus went somewhere on purpose; without a next element it was lost, and may come back.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          hadFocus.current = false;
        }
      }}
      className="hidden flex-wrap items-center gap-x-3 gap-y-2 md:flex @min-[73rem]:hidden"
    >
      <span id={labelId} className="text-sm text-muted-foreground">
        {t('jumpLabel')}
      </span>
      <ul className="flex flex-wrap gap-2">
        {columns.map(({ key, name, total }) => (
          <li key={key}>
            <Button variant="secondary" size="sm" onClick={() => jumpToColumn(row.current, key)}>
              <span aria-hidden="true">{name}</span>
              <LaneCount total={total} />
              <span className="sr-only">{t('laneHeading', { lane: name, count: total })}</span>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
