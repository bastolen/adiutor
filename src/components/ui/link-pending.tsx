/**
 * @file Shows that a link was followed and its page is on its way, for the
 * links that change what a list shows (its page, page size or filter): the
 * list stays on screen until the new rows arrive.
 */
'use client';

import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

import Spinner from './spinner';

/**
 * Wraps a link's icon or label and swaps it for a spinner while the link's
 * page loads, without moving anything (what it wraps keeps its space). It's
 * busy then (`aria-busy`, with the wait cursor). What it wraps is made
 * transparent, not hidden (`visibility: hidden` would take a wrapped label
 * out of the accessibility tree and leave the link without a name while its
 * page loads). Must be rendered inside a `Link`.
 *
 * @param props - Component props.
 * @param props.children - The icon or label shown when nothing is loading.
 */
export default function LinkPendingIndicator({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-busy={pending || undefined}
      className="relative inline-flex items-center justify-center"
    >
      <span className={cn('inline-flex', pending && 'opacity-0')}>{children}</span>
      {pending && <Spinner className="absolute size-3.5" />}
    </span>
  );
}
