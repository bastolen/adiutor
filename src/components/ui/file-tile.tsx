/**
 * @file A file as a tile (an attachment, or a file waiting to be sent): a
 * thumbnail for an image, or an icon for its kind, its name and a line under
 * it (its size, how far an upload is, what went wrong), and room for actions
 * in a corner. Given a link, the whole tile is that link (to download it);
 * given `onOpen`, the whole tile is a button that opens the file (in a
 * viewer); either way the actions sit above it. Presentational: its text
 * comes from its caller.
 */
'use client';

import { Play } from 'lucide-react';
import { type ReactNode, type Ref, useState } from 'react';

import cn from '@/lib/cn';

/** Props for {@link FileTile}. */
interface FileTileProps {
  /** The file's name, shown in full (wrapped anywhere). */
  name: string;
  /** The line under the name, e.g. its size. */
  detail: ReactNode;
  /**
   * The icon for its kind, rendered (e.g. `<FileText aria-hidden="true" />`,
   * so a Server Component can give it), shown without a thumbnail or when
   * one can't load; the tile sizes and colours it.
   */
  icon: ReactNode;
  /** An image's address, for its thumbnail. */
  thumbnail?: string;
  /**
   * Which part of the thumbnail shows when it doesn't fit the tile's shape:
   * its middle, or its top (a page, whose title is at the top).
   */
  thumbnailPosition?: 'center' | 'top';
  /** Whether the thumbnail is a video's frame, marked with a play button's shape (decorative). */
  playMark?: boolean;
  /** Where the tile links to (the file, to download it); the tile is a link only with one. */
  href?: string;
  /** The link's name for screen readers, which must hold the name, e.g. "Download error.png, 240 kB". */
  linkLabel?: string;
  /** Opens the file (in a viewer): the whole tile is a button that does, instead of a link. */
  onOpen?: () => void;
  /** The open button's name for screen readers, which must hold the name, e.g. "Open error.png, 240 kB". */
  openLabel?: string;
  /** A ref to the open button, so focus can come back to it (when the viewer closes). */
  openRef?: Ref<HTMLButtonElement>;
  /** Buttons in the tile's top corner, e.g. Remove, above the link. */
  actions?: ReactNode;
  /** Whether it's shown as one that's gone (dashed, without a thumbnail). */
  gone?: boolean;
  /** More under the line, e.g. a progress bar or an error. */
  children?: ReactNode;
}

/**
 * A file as a tile. A thumbnail loads lazily from Adiutor's own address (the
 * Content Security Policy allows images from it only), and is decorative:
 * the name says what it is. One that can't load gives way to the icon.
 *
 * @param props - Tile props.
 * @param props.name - The file's name.
 * @param props.detail - The line under the name.
 * @param props.icon - The icon for its kind.
 * @param props.thumbnail - An image's address, for its thumbnail.
 * @param props.thumbnailPosition - Which part of the thumbnail shows when it doesn't fit.
 * @param props.playMark - Whether the thumbnail is a video's frame.
 * @param props.href - Where the tile links to.
 * @param props.linkLabel - The link's name for screen readers.
 * @param props.onOpen - Opens the file; the tile is a button that does.
 * @param props.openLabel - The open button's name for screen readers.
 * @param props.openRef - A ref to the open button.
 * @param props.actions - Buttons in the tile's top corner.
 * @param props.gone - Whether it's shown as one that's gone.
 * @param props.children - More under the line.
 */
export default function FileTile({
  name,
  detail,
  icon,
  thumbnail = undefined,
  thumbnailPosition = 'center',
  playMark = false,
  href = undefined,
  linkLabel = undefined,
  onOpen = undefined,
  openLabel = undefined,
  openRef = undefined,
  actions = null,
  gone = false,
  children = null,
}: FileTileProps) {
  const [failed, setFailed] = useState(false);
  const showThumbnail = thumbnail !== undefined && !failed && !gone;
  const nameClass = 'text-sm font-medium wrap-anywhere text-foreground';

  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-lg border bg-surface transition-colors',
        gone ? 'border-dashed border-border' : 'border-border',
        (href || onOpen) &&
          'hover:border-muted-foreground has-[[data-tile-action]:focus-visible]:outline-2 has-[[data-tile-action]:focus-visible]:outline-offset-2 has-[[data-tile-action]:focus-visible]:outline-ring',
      )}
    >
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
        {showThumbnail && playMark && (
          // Says it's a video, as the name does; the play button's shape, not a button.
          <span
            aria-hidden="true"
            className="absolute flex size-9 items-center justify-center rounded-full bg-foreground text-surface shadow-md ring-2 ring-surface"
          >
            <Play className="size-4 translate-x-px fill-current" />
          </span>
        )}
        {showThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- Served by Adiutor's own route, which needs the viewer's session: Next's image optimizer fetches without it.
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className={cn(
              'size-full object-cover',
              thumbnailPosition === 'top' ? 'object-top' : 'object-center',
            )}
          />
        ) : (
          <span className="text-muted-foreground [&>svg]:size-8">{icon}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        {/* eslint-disable-next-line no-nested-ternary -- three kinds of tile: opens, links, or neither */}
        {onOpen ? (
          <button
            ref={openRef}
            type="button"
            data-tile-action=""
            aria-label={openLabel}
            onClick={onOpen}
            className={cn(
              nameClass,
              // The whole tile is the button.
              'cursor-pointer text-left after:absolute after:inset-0 hover:underline focus-visible:outline-none',
            )}
          >
            {name}
          </button>
        ) : href ? (
          <a
            href={href}
            data-tile-action=""
            aria-label={linkLabel}
            className={cn(
              nameClass,
              // The whole tile is the link.
              'after:absolute after:inset-0 hover:underline focus-visible:outline-none',
            )}
          >
            {name}
          </a>
        ) : (
          <span className={cn(nameClass, gone && 'text-muted-foreground line-through')}>
            {name}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{detail}</span>
        {children}
      </div>
      {actions && <div className="absolute top-1.5 right-1.5 z-10 flex gap-1">{actions}</div>}
    </div>
  );
}
