/**
 * @file The parts of a card that holds several settings, like Settings'
 * Attachments card: each part has a heading of its own (an `h3` under the
 * card's `h2`), an optional description and its controls, and the parts are
 * divided by lines. Each part is a group named by its heading, so a screen
 * reader says which part a "Save" belongs to.
 *
 * A client component because its ids come from `useId` (why: "Ids stay unique
 * across pages kept alive" in docs/design.md).
 */
'use client';

import { type ReactNode, useId } from 'react';

/**
 * The divided list of a card's parts, edge to edge: give the `Card` `flush`,
 * so each part brings the card's 24px padding itself.
 *
 * @param props - Component props.
 * @param props.children - The parts, each a {@link CardSection}.
 */
export function CardSections({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border border-t border-border">{children}</div>;
}

/**
 * Props for {@link CardSection}.
 */
interface CardSectionProps {
  /** The part's heading, which also names its group. */
  title: string;
  /** Short explanation below the heading. */
  description?: string;
  /** The part's controls. */
  children: ReactNode;
}

/**
 * One part of a card: its heading and description, then its controls, with
 * the card's 24px padding on every side.
 */
export default function CardSection({ title, description = '', children }: CardSectionProps) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
