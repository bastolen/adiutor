/**
 * @file The link from a file in the Files card to the text it was sent with:
 * the description, or a reply or internal note. When that text is on the
 * page, the link brings it into view and focuses it; when it isn't (a reply
 * further back than the page shows, or in a group the reader hides), it
 * opens the page at it (`?entry=`, which shows that entry whatever the
 * groups), then focuses it. Next.js never moves focus after a navigation,
 * so the link does.
 */
'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useTransition } from 'react';

import { showAndFocus, shownElementById } from '@/components/ui/focus-fallback';
import Spinner from '@/components/ui/spinner';
import TextLink from '@/components/ui/text-link';

/**
 * A link to the text a file was sent with. A click with a modifier key (a
 * new tab) is left to the browser. It isn't prefetched: a card full of rows
 * would prefetch a page each.
 *
 * @param props - Link props.
 * @param props.href - The page at the text (`requestPathAt`).
 * @param props.anchor - The text's anchor on the page (`entryAnchor`, `DESCRIPTION_ANCHOR`).
 * @param props.children - The link's text, e.g. "Reply by Pat, Nov 3, 2026".
 */
export default function TextSourceLink({
  href,
  anchor,
  children,
}: {
  href: string;
  anchor: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Set while the page opens at the text, so it's focused once it's there.
  const opening = useRef(false);

  useEffect(() => {
    if (pending || !opening.current) {
      return;
    }
    opening.current = false;
    const target = shownElementById(anchor);
    if (target) {
      showAndFocus(target);
    }
  }, [pending, anchor]);

  return (
    <TextLink
      standalone
      href={href}
      prefetch={false}
      aria-busy={pending || undefined}
      // Tall enough to be a target of its own (WCAG 2.2's target size), though its text is small.
      className="inline-flex min-h-6 items-center gap-1"
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        const target = shownElementById(anchor);
        if (target) {
          showAndFocus(target);
          return;
        }
        opening.current = true;
        startTransition(() => router.push(href));
      }}
    >
      {children}
      {pending && <Spinner className="size-3" />}
    </TextLink>
  );
}
