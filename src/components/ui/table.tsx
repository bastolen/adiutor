/**
 * @file Semantic table for lists of records (members, invitations, ...).
 */
import type { ComponentProps, ReactNode } from 'react';

import cn from '@/lib/cn';

/**
 * Props for {@link Table}.
 */
interface TableProps {
  /** Describes the table for screen readers. */
  caption: string;
  /** `<thead>` and `<tbody>` content. */
  children: ReactNode;
}

/**
 * A full-width table that scrolls sideways on narrow screens instead of
 * breaking the layout. The caption names it for screen readers.
 *
 * @param props - Table props.
 * @param props.caption - Accessible description.
 * @param props.children - Header and body.
 * @returns The table.
 */
export function Table({ caption, children }: TableProps) {
  return (
    // `relative` keeps visually hidden text (absolutely positioned) inside the scroll area;
    // otherwise it escapes and makes the whole page scroll sideways on small screens.
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/**
 * A column header cell.
 *
 * @param props - Cell props.
 * @param props.className - Extra classes.
 * @returns The header cell.
 */
export function Th({ className = '', ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-y border-border bg-muted/60 px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:px-6',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A data cell.
 *
 * @param props - Cell props.
 * @param props.className - Extra classes.
 * @returns The cell.
 */
export function Td({ className = '', ...props }: ComponentProps<'td'>) {
  return (
    <td className={cn('px-4 py-3 align-middle text-foreground sm:px-6', className)} {...props} />
  );
}

/**
 * Classes for the first cell of the viewer's own row in a table of people: a
 * 3px bar in the accent colour on its left edge, so they can spot themselves
 * while scrolling. Decorative: the row also says it in words (`YouBadge`).
 */
export const ownRowCell = 'shadow-[inset_3px_0_0_0_var(--color-highlight)]';

/**
 * A body row with a divider below it and a subtle hover.
 *
 * @param props - Row props.
 * @param props.className - Extra classes.
 * @returns The row.
 */
export function Tr({ className = '', ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('border-b border-border last:border-b-0 hover:bg-muted/40', className)}
      {...props}
    />
  );
}
