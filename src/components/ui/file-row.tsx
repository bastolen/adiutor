/**
 * @file A file as a row in a list (`FileTile`'s compact sibling): a small
 * picture (a thumbnail, or the icon for its kind), its name with a line under
 * it, and room for actions at its end. Given `onOpen`, the whole row is a
 * button that opens the file (in a viewer); given a link, the whole row is
 * that link. Links and buttons in the line under the name, and the actions,
 * sit above it, so each stays a target of its own. Presentational: its text
 * comes from its caller.
 */
'use client';

import type { ReactNode, Ref } from 'react';

import cn from '@/lib/cn';

import { fileActionRing, FileName, FilePicture } from './file-parts';

/** Props for {@link FileRow}. */
interface FileRowProps {
  /** The file's name, shown in full (wrapped anywhere). */
  name: string;
  /** What's under the name, e.g. its size and where it was sent, which may hold a link. */
  detail: ReactNode;
  /** The icon for its kind, rendered (e.g. `<FileText aria-hidden="true" />`). */
  icon: ReactNode;
  /** An image's address, for its thumbnail. */
  thumbnail?: string;
  /** Which part of the thumbnail shows when it doesn't fit: its middle, or its top (a page). */
  thumbnailPosition?: 'center' | 'top';
  /** Whether the thumbnail is a video's frame, marked with a play button's shape (decorative). */
  playMark?: boolean;
  /** Opens the file (in a viewer): the whole row is a button that does. */
  onOpen?: () => void;
  /** The open button's name for screen readers, which must hold the name, e.g. "Open error.png, 240 kB". */
  openLabel?: string;
  /** A ref to the open button, so focus can come back to it (when the viewer closes). */
  openRef?: Ref<HTMLButtonElement>;
  /** Where the row links to (the file, to download it), when it doesn't open it. */
  href?: string;
  /** The link's name for screen readers, which must hold the name, e.g. "Download error.png, 240 kB". */
  linkLabel?: string;
  /** Buttons at the row's end, e.g. Download, above the open button. */
  actions?: ReactNode;
}

/**
 * A file as a row.
 *
 * @param props - Row props.
 * @param props.name - The file's name.
 * @param props.detail - The line under the name.
 * @param props.icon - The icon for its kind.
 * @param props.thumbnail - An image's address, for its thumbnail.
 * @param props.thumbnailPosition - Which part of the thumbnail shows when it doesn't fit.
 * @param props.playMark - Whether the thumbnail is a video's frame.
 * @param props.onOpen - Opens the file; the row is a button that does.
 * @param props.openLabel - The open button's name for screen readers.
 * @param props.openRef - A ref to the open button.
 * @param props.href - Where the row links to.
 * @param props.linkLabel - The link's name for screen readers.
 * @param props.actions - Buttons at the row's end.
 */
export default function FileRow({
  name,
  detail,
  icon,
  thumbnail = undefined,
  thumbnailPosition = 'center',
  playMark = false,
  onOpen = undefined,
  openLabel = undefined,
  openRef = undefined,
  href = undefined,
  linkLabel = undefined,
  actions = null,
}: FileRowProps) {
  return (
    <div
      className={cn(
        'relative flex items-center gap-3 rounded-md p-2 transition-colors',
        (href || onOpen) && cn('hover:bg-muted', fileActionRing),
      )}
    >
      <FilePicture
        size="row"
        icon={icon}
        thumbnail={thumbnail}
        thumbnailPosition={thumbnailPosition}
        playMark={playMark}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FileName
          name={name}
          onOpen={onOpen}
          openLabel={openLabel}
          openRef={openRef}
          href={href}
          linkLabel={linkLabel}
          // A target of its own, 24px tall, next to the links in the line under it.
          className="min-h-6"
        />
        {/* A link or button in it stays a target of its own, above the row's. */}
        <span className="text-xs text-muted-foreground [&_:is(a,button)]:relative [&_:is(a,button)]:z-10">
          {detail}
        </span>
      </div>
      {actions && <div className="relative z-10 flex shrink-0 gap-1">{actions}</div>}
    </div>
  );
}
