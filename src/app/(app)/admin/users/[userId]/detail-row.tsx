/**
 * @file A label and value row for the description lists on the user detail
 * page (the Account and Sign-in security cards).
 */
import type { ReactNode } from 'react';

/**
 * A row in a description list.
 *
 * @param props - Component props.
 * @param props.term - The label.
 * @param props.children - The value.
 * @returns The row.
 */
export default function DetailRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-48 sm:shrink-0">{term}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm text-foreground">{children}</dd>
    </div>
  );
}
