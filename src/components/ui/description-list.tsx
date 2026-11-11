/**
 * @file A list of labels and values (`<dl>`), such as a user's account
 * details or everything recorded about an error.
 */
import type { ReactNode } from 'react';

/**
 * The list: its rows ({@link DescriptionRow}) with a line between each.
 *
 * @param props - Component props.
 * @param props.children - The rows.
 * @returns The list.
 */
export function DescriptionList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border">{children}</dl>;
}

/**
 * A label and its value: the label above the value on phones, beside it from
 * 640px, lined up on the value's first line. The value can mix text and
 * badges, which wrap onto more lines as needed, and long text such as an
 * address or an error message breaks anywhere rather than run out of the
 * card.
 *
 * @param props - Component props.
 * @param props.term - The label.
 * @param props.children - The value.
 * @returns The row.
 */
export function DescriptionRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="text-sm text-muted-foreground sm:w-48 sm:shrink-0">{term}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm wrap-anywhere text-foreground">
        {children}
      </dd>
    </div>
  );
}
