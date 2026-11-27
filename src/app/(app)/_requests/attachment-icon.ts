/**
 * @file The icon for an attached file's kind, by its name's extension: an
 * image, a video, an archive, a spreadsheet, or else a document; and how its
 * preview shows. For the attachments under a text, the Files card and the
 * files waiting to be sent alike.
 */
import {
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';

import { attachmentTypeOf } from '@/lib/requests';

/** The icon of each kind, by extension. */
const ICONS: Record<string, LucideIcon> = {
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  heic: FileImage,
  heif: FileImage,
  mp4: FileVideo,
  m4v: FileVideo,
  mov: FileVideo,
  webm: FileVideo,
  zip: FileArchive,
  '7z': FileArchive,
  gz: FileArchive,
  tgz: FileArchive,
  xlsx: FileSpreadsheet,
  ods: FileSpreadsheet,
  csv: FileSpreadsheet,
};

/**
 * The icon for a file.
 *
 * @param name - Its name.
 * @returns Its kind's icon, a document's for anything else.
 */
export default function attachmentIcon(name: string): LucideIcon {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return ICONS[extension] ?? FileText;
}

/**
 * How a file's preview shows, by its kind: a page (a PDF's, or an Office
 * file's thumbnail) from its top, where its title is, and a video's frame
 * with a play mark.
 *
 * @param name - The file's name.
 * @returns Which part of the preview shows, and whether it's marked as a video.
 */
export function previewLook(name: string): {
  thumbnailPosition: 'center' | 'top';
  playMark: boolean;
} {
  const kind = attachmentTypeOf(name)?.preview;
  return {
    thumbnailPosition: kind === 'pdf' || kind === 'office' ? 'top' : 'center',
    playMark: kind === 'video',
  };
}
