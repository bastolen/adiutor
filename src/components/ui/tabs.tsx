/**
 * @file Tabs inside a page: a row of buttons that switches between panels
 * in place (the WAI-ARIA tabs pattern, through Radix Tabs). For sections
 * that are pages of their own, use `SegmentTabNav`, whose tabs are links.
 */
'use client';

import type { LucideIcon } from 'lucide-react';
import { Tabs as RadixTabs } from 'radix-ui';
import { type ReactNode, useState } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/** One tab in {@link Tabs}. */
export interface TabItem {
  /** What tells the tabs apart; not shown. */
  value: string;
  /** The tab's visible name. */
  label: string;
  /** An icon before the name, which the name already says (decorative). */
  icon?: LucideIcon;
  /** The panel the tab shows. */
  content: ReactNode;
}

/** Props for {@link Tabs}. */
interface TabsProps {
  /** The name of the row of tabs for screen readers, e.g. "Write". */
  label: string;
  /** The tabs, in order; the first is open to begin with. */
  items: readonly TabItem[];
}

/**
 * Tabs with the look of `SegmentTabNav`: an underline under the open tab,
 * which forced-colours mode outlines too (where every underline looks the
 * same). The arrow keys move between the tabs and open the one they reach,
 * Home and End go to the first and last, and Tab goes on into the open
 * panel.
 *
 * Every panel stays mounted while it's hidden, so what someone typed in one
 * (a draft) is still there when they come back to it. Which tab is open is
 * kept while the page is (pages stay alive across navigation), like the
 * drafts in it.
 *
 * @returns The tabs and their panels.
 */
export default function Tabs({ label, items }: TabsProps) {
  const [open, setOpen] = useState(items[0]?.value);
  return (
    <RadixTabs.Root value={open} onValueChange={setOpen} className="flex flex-col gap-4">
      <RadixTabs.List aria-label={label} className="flex gap-1 border-b border-border">
        {items.map(({ value, label: name, icon: Icon }) => (
          <RadixTabs.Trigger
            key={value}
            value={value}
            className={cn(
              '-mb-px inline-flex h-10 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
              'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
              'data-[state=active]:border-highlight data-[state=active]:text-foreground',
              'forced-colors:aria-selected:not-focus-visible:outline-2 forced-colors:aria-selected:not-focus-visible:-outline-offset-2',
              focusRing,
            )}
          >
            {Icon && <Icon aria-hidden="true" className="size-4" />}
            {name}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map(({ value, content }) => (
        <RadixTabs.Content
          key={value}
          value={value}
          forceMount
          // Mounted, but out of sight, of the tab order and of screen readers while it's closed.
          hidden={value !== open}
          // The panel itself isn't a stop for Tab: its first field or button is.
          tabIndex={-1}
        >
          {content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
