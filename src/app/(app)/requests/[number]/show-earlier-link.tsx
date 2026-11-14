/**
 * @file The link above a request's conversation that shows earlier entries.
 * A client component for one reason: once every entry is shown the link is
 * gone, and focus then moves to the conversation's heading instead of
 * falling to the page.
 */
'use client';

import Link from 'next/link';
import { type ReactNode, useLayoutEffect, useRef } from 'react';

import restoreFocusIfLost from '@/components/ui/focus-fallback';
import LinkPendingIndicator from '@/components/ui/link-pending';
import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';

/**
 * A link that loads earlier entries of the conversation it's in, without
 * scrolling the page. It shows a spinner while they load.
 *
 * @param props - Component props.
 * @param props.href - The page with more of the conversation.
 * @param props.children - The link's text.
 * @returns The link.
 */
export default function ShowEarlierLink({ href, children }: { href: string; children: ReactNode }) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const followed = useRef(false);

  useLayoutEffect(() => {
    const link = linkRef.current;
    return () => {
      // The last earlier entries arrived and took this link away: don't leave focus on <body>.
      if (followed.current) {
        restoreFocusIfLost(link);
      }
    };
  }, []);

  return (
    <Link
      ref={linkRef}
      href={href}
      scroll={false}
      onClick={() => {
        followed.current = true;
      }}
      className={cn(
        '-my-0.5 inline-flex w-fit items-center gap-2 rounded-sm py-0.5 text-sm font-medium text-highlight underline-offset-4 hover:underline',
        focusRing,
      )}
    >
      <LinkPendingIndicator>{children}</LinkPendingIndicator>
    </Link>
  );
}
