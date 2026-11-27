/**
 * @file A request's file as a row in the Files card, which opens it in the
 * page's viewer (decision 0058), with a Download button at its end and,
 * under its name, its size and where it was sent. Without a viewer on the
 * page, the row downloads the file.
 */
'use client';

import type { ReactNode } from 'react';

import FileRow from '@/components/ui/file-row';

import { useFileOpener } from './attachment-viewer';
import { DownloadButton } from './viewable-attachment-tile';

/**
 * A file's row, which opens it in the viewer.
 *
 * @param props - Row props.
 * @param props.id - The file's ID.
 * @param props.name - Its name.
 * @param props.detail - The line under the name (its size and where it was sent).
 * @param props.icon - The icon for its kind, rendered.
 * @param props.thumbnail - Its preview's address, if it has one.
 * @param props.thumbnailPosition - Which part of the preview shows.
 * @param props.playMark - Whether the preview is a video's frame.
 * @param props.openLabel - The open button's name, e.g. "Open error.png, 240 kB".
 * @param props.downloadLabel - The Download button's name, e.g. "Download error.png, 240 kB".
 */
export default function ViewableAttachmentRow({
  id,
  name,
  detail,
  icon,
  thumbnail = undefined,
  thumbnailPosition = 'center',
  playMark = false,
  openLabel,
  downloadLabel,
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
}) {
  const opener = useFileOpener(id, 'files');
  return (
    <FileRow
      name={name}
      detail={detail}
      icon={icon}
      thumbnail={thumbnail}
      thumbnailPosition={thumbnailPosition}
      playMark={playMark}
      onOpen={opener?.onOpen}
      openLabel={openLabel}
      openRef={opener?.ref}
      href={opener ? undefined : `/attachments/${id}`}
      linkLabel={downloadLabel}
      actions={opener && <DownloadButton id={id} label={downloadLabel} />}
    />
  );
}
