/**
 * @file The parts a file is shown with, whatever its shape (`FileTile`'s
 * tile, `FileRow`'s row): its picture (a thumbnail, or the icon for its
 * kind) and its name, which is the button that opens it, the link that
 * downloads it, or plain text. The name's button or link stretches over
 * whatever holds it (`relative`), so the whole tile or row is one target,
 * and marks itself with `data-file-action`, for the holder's focus ring.
 * Presentational: their text comes from their caller.
 */
'use client';

import { Play } from 'lucide-react';
import { type ReactNode, type Ref, useState } from 'react';

import cn from '@/lib/cn';

/** The picture's sizes: a tile's, across its width, or a row's, a small square at its start. */
const PICTURE_SIZES = {
  tile: { box: 'aspect-[4/3]', icon: '[&>svg]:size-8', mark: 'size-9', play: 'size-4' },
  row: {
    box: 'size-12 shrink-0 rounded-md border border-border',
    icon: '[&>svg]:size-6',
    mark: 'size-6',
    play: 'size-3',
  },
} as const;

/** Props for {@link FilePicture}. */
interface FilePictureProps {
  /** How big it is: a tile's, or a row's. */
  size: keyof typeof PICTURE_SIZES;
  /** The icon for its kind, rendered, shown without a thumbnail or when one can't load. */
  icon: ReactNode;
  /** An image's address, for its thumbnail. */
  thumbnail?: string;
  /** Which part of the thumbnail shows when it doesn't fit: its middle, or its top (a page). */
  thumbnailPosition?: 'center' | 'top';
  /** Whether the thumbnail is a video's frame, marked with a play button's shape (decorative). */
  playMark?: boolean;
  /** Whether the file is gone, which shows its icon, never a thumbnail. */
  gone?: boolean;
}

/**
 * A file's picture. A thumbnail loads lazily from Adiutor's own address (the
 * Content Security Policy allows images from it only), and is decorative:
 * the name says what it is. One that can't load gives way to the icon.
 *
 * @param props - Picture props.
 * @param props.size - How big it is.
 * @param props.icon - The icon for its kind.
 * @param props.thumbnail - An image's address, for its thumbnail.
 * @param props.thumbnailPosition - Which part of the thumbnail shows when it doesn't fit.
 * @param props.playMark - Whether the thumbnail is a video's frame.
 * @param props.gone - Whether the file is gone.
 */
export function FilePicture({
  size,
  icon,
  thumbnail = undefined,
  thumbnailPosition = 'center',
  playMark = false,
  gone = false,
}: FilePictureProps) {
  const [failed, setFailed] = useState(false);
  const showThumbnail = thumbnail !== undefined && !failed && !gone;
  const sizes = PICTURE_SIZES[size];
  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-muted',
        sizes.box,
      )}
    >
      {showThumbnail && playMark && (
        // Says it's a video, as the name does; the play button's shape, not a button.
        <span
          aria-hidden="true"
          className={cn(
            'absolute flex items-center justify-center rounded-full bg-foreground text-surface shadow-md ring-2 ring-surface',
            sizes.mark,
          )}
        >
          <Play className={cn('translate-x-px fill-current', sizes.play)} />
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
        <span className={cn('text-muted-foreground', sizes.icon)}>{icon}</span>
      )}
    </div>
  );
}

/**
 * The classes of a tile or row whose name opens or links: a border or
 * background on hover from its caller, and the focus ring around all of it
 * while its name's button or link has keyboard focus.
 */
export const fileActionRing =
  'has-[[data-file-action]:focus-visible]:outline-2 has-[[data-file-action]:focus-visible]:outline-offset-2 has-[[data-file-action]:focus-visible]:outline-ring';

/** Props for {@link FileName}. */
interface FileNameProps {
  /** The file's name, shown in full (wrapped anywhere). */
  name: string;
  /** Opens the file (in a viewer): the name is a button that does, over all of its holder. */
  onOpen?: () => void;
  /** The open button's name for screen readers, which must hold the name, e.g. "Open error.png, 240 kB". */
  openLabel?: string;
  /** A ref to the open button, so focus can come back to it (when the viewer closes). */
  openRef?: Ref<HTMLButtonElement>;
  /** Where the name links to (the file, to download it), when it doesn't open it. */
  href?: string;
  /** The link's name for screen readers, which must hold the name, e.g. "Download error.png, 240 kB". */
  linkLabel?: string;
  /** Whether the file is gone, which strikes its name through. */
  gone?: boolean;
}

/**
 * A file's name: the button that opens it, else the link that downloads
 * it, else plain text.
 *
 * @param props - Name props.
 * @param props.name - The file's name.
 * @param props.onOpen - Opens the file.
 * @param props.openLabel - The open button's name for screen readers.
 * @param props.openRef - A ref to the open button.
 * @param props.href - Where the name links to.
 * @param props.linkLabel - The link's name for screen readers.
 * @param props.gone - Whether the file is gone.
 */
export function FileName({
  name,
  onOpen = undefined,
  openLabel = undefined,
  openRef = undefined,
  href = undefined,
  linkLabel = undefined,
  gone = false,
}: FileNameProps) {
  const nameClass = 'text-sm font-medium wrap-anywhere text-foreground';
  if (onOpen) {
    return (
      <button
        ref={openRef}
        type="button"
        data-file-action=""
        aria-label={openLabel}
        onClick={onOpen}
        className={cn(
          nameClass,
          // The whole tile or row is the button.
          'cursor-pointer text-left after:absolute after:inset-0 hover:underline focus-visible:outline-none',
        )}
      >
        {name}
      </button>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        data-file-action=""
        aria-label={linkLabel}
        className={cn(
          nameClass,
          // The whole tile or row is the link.
          'after:absolute after:inset-0 hover:underline focus-visible:outline-none',
        )}
      >
        {name}
      </a>
    );
  }
  return (
    <span className={cn(nameClass, gone && 'text-muted-foreground line-through')}>{name}</span>
  );
}
