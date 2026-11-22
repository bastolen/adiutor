'use client';

/**
 * @file Section tabs for a layout: underlined links whose current tab is the
 * route segment below the layout, read in the browser, so the tabs stay
 * mounted (and the chosen tab keeps focus) while the pages under them change.
 */
import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

import cn from '@/lib/cn';

import { currentItem, focusRing } from './styles';

/** One tab in a {@link SegmentTabNav}. */
interface SegmentTab {
  /** Where it goes. */
  href: string;
  /** Visible text. */
  label: string;
  /** The route segment below the layout it opens, or `null` for the layout's own page. */
  segment: string | null;
}

/**
 * Props for {@link SegmentTabNav}.
 */
interface SegmentTabNavProps {
  /** Name of the navigation landmark, e.g. "Company sections". */
  label: string;
  /** The tabs, in order. */
  items: readonly SegmentTab[];
}

/**
 * A row of section links with an underline under the open section's, marked
 * with `aria-current="page"` (and outlined in forced-colours mode, where every
 * link's line looks the same: `currentItem`). Each section is its own page, so these are
 * links, not ARIA tabs. Render it from the layout of the sections, not from
 * their pages. Tabs that don't fit the width (long names on a phone, in some
 * languages) wrap onto another row, so every tab stays in sight and the page
 * never scrolls sideways.
 *
 * @param props - Navigation props.
 * @param props.label - Landmark name.
 * @param props.items - The tabs.
 * @returns The navigation.
 */
export default function SegmentTabNav({ label, items }: SegmentTabNavProps) {
  const current = useSelectedLayoutSegment();
  return (
    <nav aria-label={label} className="-mb-px border-b border-border">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          const isCurrent = item.segment === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors',
                  focusRing,
                  currentItem,
                  isCurrent
                    ? 'border-highlight text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
