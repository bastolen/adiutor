/**
 * @file Card: a titled surface that groups related content on a page. Its
 * heading can take focus, so focus has somewhere to go when a control in the
 * card disappears (see `focus-fallback.ts`), and a card with an anchor (`id`)
 * is where users land when they come back to the page (see
 * `anchored-section.tsx`).
 */
import { type ReactNode, useId } from 'react';

import cn from '@/lib/cn';

import AnchoredSection from './anchored-section';
import { focusRing } from './styles';

/**
 * Props for {@link Card}.
 */
interface CardProps {
  /**
   * The card's anchor, a section ID like `invitations` (lowercase letters,
   * digits and hyphens; see `isSectionId` in `src/lib/redirect.ts`). Give one
   * when a control in the card can send the user away and back (a
   * confirmation, a provider, an emailed link), so they come back to this
   * card; it also makes `/page#id` a link to it.
   */
  id?: string;
  /** Heading text. */
  title?: string;
  /** Short explanation below the heading. */
  description?: string;
  /** Controls shown next to the heading, e.g. a button; vertically centred against it. */
  actions?: ReactNode;
  /** Content shown in a separated area at the bottom. */
  footer?: ReactNode;
  /** `danger` highlights destructive settings. */
  tone?: 'default' | 'danger';
  /** Remove the inner padding, e.g. for edge-to-edge tables. */
  flush?: boolean;
  /** The card's content. */
  children?: ReactNode;
}

/**
 * A bordered surface with an optional heading, description, actions and
 * footer, with 24px padding on every side. It's a `<section>` labelled by its
 * heading, so screen readers can jump to it. With an `id`, users who come
 * back to the page with that anchor land on it, with focus on its heading,
 * and scrolling to it leaves room for the sticky header on small screens and
 * for the signed-in-as banner (the page's `scroll-padding-top` in
 * `globals.css`, plus a little room of the card's own).
 *
 * @param props - Card props.
 * @param props.id - The card's anchor.
 * @param props.title - Heading text.
 * @param props.description - Short explanation.
 * @param props.actions - Controls next to the heading.
 * @param props.footer - Bottom content.
 * @param props.tone - Visual tone.
 * @param props.flush - Remove the content padding.
 * @param props.children - Content.
 * @returns The card.
 */
export default function Card({
  id = undefined,
  title = '',
  description = '',
  actions = null,
  footer = null,
  tone = 'default',
  flush = false,
  children = null,
}: CardProps) {
  const headingId = useId();
  const labelledBy = title ? headingId : undefined;
  const className = cn(
    // Scrolled to below the sticky layers (the page's `scroll-padding-top`), with a little more
    // room above: 5rem from the top below `lg` and 2.5rem from `lg`, lower while the banner shows.
    'relative scroll-mt-2 overflow-hidden rounded-xl border bg-surface shadow-xs lg:scroll-mt-4',
    tone === 'danger' ? 'border-danger/40' : 'border-border',
  );

  const content = (
    <>
      {(title || actions) && (
        <div
          className={cn(
            // Actions are centred against the heading and description, however long it is.
            'flex flex-wrap items-center justify-between gap-4 px-6 pt-6',
            // Without content below, the heading area gets the same space at the bottom.
            !children && 'pb-6',
          )}
        >
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            {title && (
              <h2
                id={headingId}
                // Focusable from script only: when a control in the card disappears, and when the
                // user comes back to the card.
                tabIndex={-1}
                data-card-heading=""
                className={cn(
                  'rounded-xs text-base font-semibold',
                  focusRing,
                  tone === 'danger' ? 'text-danger' : 'text-foreground',
                )}
              >
                {title}
              </h2>
            )}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {/* Wraps onto more lines rather than running past the card's edge on a narrow screen. */}
          {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children && (
        <div
          className={cn(
            flush ? (title || actions) && 'mt-5' : 'px-6 pt-5 pb-6',
            !title && !actions && !flush && 'pt-6',
          )}
        >
          {children}
        </div>
      )}
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-muted/60 px-6 py-3">
          {footer}
        </div>
      )}
    </>
  );

  if (id) {
    return (
      <AnchoredSection id={id} labelledBy={labelledBy} className={className}>
        {content}
      </AnchoredSection>
    );
  }
  return (
    <section
      aria-labelledby={labelledBy}
      // Where `restoreFocusIfLost` finds the heading of a removed control's card.
      data-card=""
      className={className}
    >
      {content}
    </section>
  );
}
