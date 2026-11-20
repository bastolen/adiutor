/**
 * @file A row of links that looks like a segmented control, e.g. to filter a
 * list.
 */
import Link from 'next/link';

import cn from '@/lib/cn';

import LinkPendingIndicator from './link-pending';
import { currentItem, focusRing } from './styles';

/** One link in a {@link SegmentedNav}. */
interface SegmentedNavItem {
  /** Where it goes. */
  href: string;
  /** Visible text. */
  label: string;
  /** Whether it's the current choice. */
  current: boolean;
}

/**
 * Props for {@link SegmentedNav}.
 */
interface SegmentedNavProps {
  /** Name of the navigation landmark, e.g. "Filter users". */
  label: string;
  /** The links, in order. */
  items: readonly SegmentedNavItem[];
}

/**
 * Links shown as one segmented control. They're ordinary links (Tab moves
 * between them, Enter follows one), so each choice has its own URL; the
 * current one is marked with `aria-current="page"` and raised (outlined in
 * forced-colours mode, `currentItem`). Like the Sort
 * menu and pagination, they keep the page where it is (no scroll to the top),
 * and the followed link shows a spinner in its label's place until the list
 * arrives.
 *
 * @param props - Navigation props.
 * @param props.label - Landmark name.
 * @param props.items - The links.
 * @returns The navigation.
 */
export default function SegmentedNav({ label, items }: SegmentedNavProps) {
  return (
    <nav aria-label={label}>
      <ul className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              scroll={false}
              aria-current={item.current ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors',
                focusRing,
                currentItem,
                item.current
                  ? 'bg-surface text-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-surface/60 hover:text-foreground',
              )}
            >
              <LinkPendingIndicator>{item.label}</LinkPendingIndicator>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
