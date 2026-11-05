/**
 * @file IconRow: a list row with a decorative icon, a title, an optional
 * subtitle, a description and a control on the right, such as the sign-in
 * methods on the Security page.
 */
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

/**
 * Props for {@link IconRow}.
 */
interface IconRowProps {
  /**
   * The icon, e.g. `<KeyRound className="size-4" />`. The row hides it from
   * screen readers and the caller sets its size.
   */
  icon: ReactNode;
  /**
   * Extra classes for the box around the icon. The icon's colour comes from
   * here, e.g. `text-muted-foreground`; leave it out for a coloured brand logo
   * or a mark that follows the text colour (`currentColor`).
   */
  iconClassName?: string;
  /** The row's name. */
  title: string;
  /** Cut off a long title with an ellipsis instead of wrapping it. */
  truncateTitle?: boolean;
  /**
   * A line below the title that tells this row apart, e.g. which account it
   * is. It wraps anywhere instead of being cut off, so all of it stays
   * visible.
   */
  subtitle?: string | null;
  /** Explanation below the title. */
  children: ReactNode;
  /** Badge or button(s) on the right. */
  control: ReactNode;
}

/**
 * One row of a list (`<ul>`): an icon in a bordered box, a title with an
 * explanation below it, and a control on the right. The text takes the
 * remaining width, at least 10rem, so on narrow screens the control wraps
 * below it (staying on the right) rather than squeezing it. Rows are
 * separated by the list's `divide-y divide-border`.
 *
 * @param props - Row props.
 * @param props.icon - Decorative icon.
 * @param props.iconClassName - Extra classes for the icon's box, e.g. its colour.
 * @param props.title - The row's name.
 * @param props.truncateTitle - Cut a long title off with an ellipsis.
 * @param props.subtitle - A line below the title, if any.
 * @param props.children - Explanation.
 * @param props.control - Badge or button(s) on the right.
 * @returns The list item.
 */
export default function IconRow({
  icon,
  iconClassName = undefined,
  title,
  truncateTitle = false,
  subtitle = null,
  children,
  control,
}: IconRowProps) {
  return (
    <li className="flex flex-wrap items-center gap-4 px-6 py-4">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 items-center justify-center rounded-lg border border-border bg-surface',
          iconClassName,
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 basis-40 flex-col">
        <span className={cn(truncateTitle && 'truncate', 'text-sm font-medium')}>{title}</span>
        {subtitle && <span className="text-sm break-all text-foreground">{subtitle}</span>}
        <span className="text-xs text-muted-foreground">{children}</span>
      </div>
      <div className="ml-auto">{control}</div>
    </li>
  );
}
