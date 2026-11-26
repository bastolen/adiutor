/**
 * @file The icon for an attached file's kind, by its name's extension: an
 * image, a video, an archive, a spreadsheet, or else a document. For the
 * attachments under a text and the files waiting to be sent alike.
 */
import {
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';

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
