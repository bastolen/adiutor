/**
 * @file The section of a `Card` that has an anchor (`id`). It tells the
 * controls inside which section they're in (`useSectionId`), so the return
 * addresses they send end in its anchor (`useRecentConfirmation`,
 * `ReturnToField`), and when the user comes back to the page with that anchor
 * in the URL, it brings the card into view and moves focus to its heading.
 * Next.js scrolls to an anchor itself only when the card is already on the
 * page, and never moves focus.
 */
'use client';

import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react';

import { sectionFromHash } from '@/lib/redirect';

import { focusIsLost, isShown } from './focus-fallback';

/** The anchor of the card a control is in, or `null` outside one. */
const SectionContext = createContext<string | null>(null);

/**
 * The anchor of the card the calling component is in, e.g. `invitations`.
 *
 * @returns The section ID, or `null` outside a card with an anchor.
 */
export function useSectionId(): string | null {
  return useContext(SectionContext);
}

/**
 * Props for {@link AnchoredSection}.
 */
interface AnchoredSectionProps {
  /** The anchor, a section ID (`isSectionId` in `src/lib/redirect.ts`), e.g. `invitations`. */
  id: string;
  /** The ID of the card's heading, when it has one. */
  labelledBy?: string;
  /** The card's classes. */
  className: string;
  /** The card's content. */
  children: ReactNode;
}

/**
 * A card's `<section>` with an anchor. On arrival (when it mounts, or when
 * the page is shown again from `<Activity>`, which runs effects again), one
 * frame after the page has settled, and only while the URL's fragment names
 * it:
 * - with focus nowhere in particular, it scrolls into view (below the sticky
 *   header, by its `scroll-margin-top`) and focuses the card's heading;
 * - with focus already inside it (e.g. a result message that took it), it
 *   only scrolls into view;
 * - with focus anywhere else, it leaves the page alone, so it never takes
 *   focus from a control the user is using.
 *
 * @param props - Section props.
 * @param props.id - The anchor.
 * @param props.labelledBy - The heading's ID.
 * @param props.className - The card's classes.
 * @param props.children - The card's content.
 * @returns The section.
 */
export default function AnchoredSection({
  id,
  labelledBy = undefined,
  className,
  children,
}: AnchoredSectionProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const section = ref.current;
      if (!section || sectionFromHash(window.location.hash) !== id || !isShown(section)) {
        return;
      }
      if (focusIsLost()) {
        section.scrollIntoView({ block: 'start' });
        section.querySelector<HTMLElement>('[data-card-heading]')?.focus({ preventScroll: true });
      } else if (section.contains(document.activeElement)) {
        section.scrollIntoView({ block: 'start' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [id]);

  return (
    <SectionContext value={id}>
      <section
        ref={ref}
        id={id}
        aria-labelledby={labelledBy}
        // Where `restoreFocusIfLost` finds the heading of a removed control's card.
        data-card=""
        className={className}
      >
        {children}
      </section>
    </SectionContext>
  );
}
