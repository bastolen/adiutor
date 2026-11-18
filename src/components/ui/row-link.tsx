/**
 * @file The link that makes a whole table row (or list item) one click target:
 * the row's name, stretched over the row.
 */
import Link from 'next/link';
import type { ComponentProps } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/** Props for {@link RowLink}: those of a Next.js `Link`, which brings its own classes. */
export type RowLinkProps = Omit<ComponentProps<typeof Link>, 'className'>;

/**
 * A link whose clickable area covers its whole row, so the row is one click
 * target. Its row needs the `group relative` classes: `relative` is what the
 * link stretches over, `group` underlines the name when the row is hovered.
 * On its own the link is 2px taller above and below too, like every text link
 * (at least 24px).
 *
 * @param props - The props of a `Link`, without `className`.
 * @returns The link.
 */
export default function RowLink(props: RowLinkProps) {
  return (
    <Link
      {...props}
      className={cn(
        '-my-0.5 rounded-sm py-0.5 font-medium wrap-anywhere text-foreground group-hover:underline group-hover:underline-offset-4 after:absolute after:inset-0',
        focusRing,
      )}
    />
  );
}
