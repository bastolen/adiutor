/**
 * @file Underlined tabs for the sections of a page, as links.
 */
import Link from 'next/link';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/** One tab in a {@link TabNav}. */
interface TabNavItem {
  /** Where it goes. */
  href: string;
  /** Visible text. */
  label: string;
  /** Whether it's the current section. */
  current: boolean;
}

/**
 * Props for {@link TabNav}.
 */
interface TabNavProps {
  /** Name of the navigation landmark, e.g. "Company sections". */
  label: string;
  /** The tabs, in order. */
  items: readonly TabNavItem[];
}

/**
 * A row of section links with an underline under the current one, marked
 * with `aria-current="page"`. Each section is its own page, so these are
 * links, not ARIA tabs.
 *
 * @param props - Navigation props.
 * @param props.label - Landmark name.
 * @param props.items - The tabs.
 * @returns The navigation.
 */
export default function TabNav({ label, items }: TabNavProps) {
  return (
    <nav aria-label={label} className="-mb-px border-b border-border">
      <ul className="flex gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors',
                focusRing,
                item.current
                  ? 'border-highlight text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
