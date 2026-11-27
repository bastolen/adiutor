/**
 * @file A list that shows its first few items, and the rest when asked: a
 * "Show all" button under it that expands it in place and goes away, with
 * focus moving to the first item it adds. Whether it's expanded is kept
 * while the page is (a view the reader chose, like a scroll position, not a
 * message or an open dialog, so not transient state). Presentational: its
 * text comes from its caller.
 */
'use client';

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import Button from './button';
import restoreFocusIfLost from './focus-fallback';

/** What can take focus in an item, for the first item added. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Props for {@link ShowMoreList}. */
interface ShowMoreListProps {
  /** The list's name for screen readers. */
  label: string;
  /** How many items it shows until it's expanded. */
  shown: number;
  /** The button's text, e.g. "Show all 7 files". */
  moreLabel: string;
  /** The items, each with a key of its own. */
  items: readonly { key: string; content: ReactNode }[];
}

/**
 * A list that shows more when asked.
 *
 * @param props - List props.
 * @param props.label - The list's name for screen readers.
 * @param props.shown - How many items it shows until it's expanded.
 * @param props.moreLabel - The button's text.
 * @param props.items - The items.
 */
export default function ShowMoreList({ label, shown, moreLabel, items }: ShowMoreListProps) {
  const [expanded, setExpanded] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // Set when the button is pressed, so focus moves once the added items are there.
  const justExpanded = useRef(false);

  useLayoutEffect(() => {
    if (!justExpanded.current) {
      return;
    }
    justExpanded.current = false;
    // The button that had focus is gone: the first item it added takes it, or else the card.
    const target = list.current?.children[shown]?.querySelector<HTMLElement>(FOCUSABLE);
    if (target) {
      target.focus();
    } else {
      restoreFocusIfLost(list.current);
    }
  }, [expanded, shown]);

  const hidden = items.length - shown;
  return (
    <div className="flex flex-col gap-2">
      <ul ref={list} aria-label={label} className="flex flex-col">
        {(expanded ? items : items.slice(0, shown)).map(({ key, content }) => (
          <li key={key}>{content}</li>
        ))}
      </ul>
      {!expanded && hidden > 0 && (
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={() => {
            justExpanded.current = true;
            setExpanded(true);
          }}
        >
          {moreLabel}
        </Button>
      )}
    </div>
  );
}
