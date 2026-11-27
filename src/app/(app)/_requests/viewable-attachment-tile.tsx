/**
 * @file A request's file as a tile that opens it in the page's viewer
 * (decision 0058), with a Download button of its own in its corner, beside
 * any other action (Remove, for the staff who may). Without a viewer on the
 * page, the tile downloads the file, as before.
 */
'use client';

import { Download } from 'lucide-react';
import type { ReactNode } from 'react';

import Button from '@/components/ui/button';
import FileTile from '@/components/ui/file-tile';

import { useFileOpener } from './attachment-viewer';

/**
 * A file's tile, which opens it in the viewer.
 *
 * @param props - Tile props.
 * @param props.id - The file's ID.
 * @param props.name - Its name.
 * @param props.detail - The line under the name (its size).
 * @param props.icon - The icon for its kind, rendered.
 * @param props.thumbnail - Its preview's address, if it has one.
 * @param props.thumbnailPosition - Which part of the preview shows.
 * @param props.playMark - Whether the preview is a video's frame.
 * @param props.openLabel - The open button's name, e.g. "Open error.png, 240 kB".
 * @param props.downloadLabel - The Download button's name, e.g. "Download error.png, 240 kB".
 * @param props.actions - Other actions for the corner (Remove).
 */
export default function ViewableAttachmentTile({
  id,
  name,
  detail,
  icon,
  thumbnail = undefined,
  thumbnailPosition = 'center',
  playMark = false,
  openLabel,
  downloadLabel,
  actions = null,
}: {
  id: string;
  name: string;
  detail: ReactNode;
  icon: ReactNode;
  thumbnail?: string;
  thumbnailPosition?: 'center' | 'top';
  playMark?: boolean;
  openLabel: string;
  downloadLabel: string;
  actions?: ReactNode;
}) {
  const opener = useFileOpener(id, 'text');
  const href = `/attachments/${id}`;
  return (
    <FileTile
      name={name}
      detail={detail}
      icon={icon}
      thumbnail={thumbnail}
      thumbnailPosition={thumbnailPosition}
      playMark={playMark}
      onOpen={opener?.onOpen}
      openLabel={openLabel}
      openRef={opener?.ref}
      href={opener ? undefined : href}
      linkLabel={downloadLabel}
      actions={
        <>
          {opener && (
            <Button asChild variant="secondary" size="sm" className="px-1.5">
              <a href={href} download aria-label={downloadLabel}>
                <Download aria-hidden="true" />
              </a>
            </Button>
          )}
          {actions}
        </>
      }
    />
  );
}
