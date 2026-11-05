'use client';

/**
 * @file Section tabs for a layout: a {@link TabNav} whose current tab is the
 * route segment below the layout, read in the browser, so the tabs stay
 * mounted (and the chosen tab keeps focus) while the pages under them change.
 */
import { useSelectedLayoutSegment } from 'next/navigation';

import TabNav from './tab-nav';

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
 * Section tabs that mark the open section with `aria-current="page"`. Render
 * it from the layout of the sections, not from their pages.
 *
 * @param props - Navigation props.
 * @param props.label - Landmark name.
 * @param props.items - The tabs.
 * @returns The navigation.
 */
export default function SegmentTabNav({ label, items }: SegmentTabNavProps) {
  const current = useSelectedLayoutSegment();
  return (
    <TabNav
      label={label}
      items={items.map(({ segment, ...item }) => ({ ...item, current: segment === current }))}
    />
  );
}
