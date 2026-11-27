/**
 * @file Finds the thumbnail an Office or OpenDocument file carries: an
 * OpenDocument file (`.odt`, `.ods`, `.odp`) always keeps one at
 * `Thumbnails/thumbnail.png`; an Office file (`.docx`, `.xlsx`, `.pptx`)
 * keeps one only when the program that saved it chose to, named by its
 * package's relationships (`_rels/.rels`), usually a JPEG at
 * `docProps/thumbnail.jpeg`. The thumbnail is the file's own claim of what
 * it looks like, drawn again like an image, PNG or JPEG only (never the WMF
 * or EMF some Office versions write).
 */
import type { AttachmentCheck } from '@/lib/requests';

import drawImage from './draw-image';
import { OFFICE_LIMITS } from './limits';
import { listZipEntries, readZipEntry, type ZipEntry, type ZipLimits } from './zip-entry';

/** Where an OpenDocument file keeps its thumbnail. */
const ODF_THUMBNAIL = 'Thumbnails/thumbnail.png';

/** Where an Office file lists its package's parts. */
const PACKAGE_RELATIONSHIPS = '_rels/.rels';

/** The end of a thumbnail relationship's type (the same in transitional and strict files). */
const THUMBNAIL_TYPE = '/metadata/thumbnail';

/** The most a package's relationships may take, unpacked: a few hundred bytes as a rule. */
const MAX_RELATIONSHIPS_BYTES = 64 * 1024;

/** The kinds of image a thumbnail may be. */
const THUMBNAIL_CHECKS: readonly AttachmentCheck[] = ['png', 'jpeg'];

/**
 * An attribute of an XML tag, by name.
 *
 * @param tag - The tag's text.
 * @param name - The attribute's name.
 * @returns Its value, or `null` without it.
 */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/**
 * Where an Office file's relationships say its thumbnail is.
 *
 * @param relationships - `_rels/.rels`, as text.
 * @returns The thumbnail's name in the archive, or `null` without one.
 */
export function thumbnailTarget(relationships: string): string | null {
  for (const [tag] of relationships.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const type = attribute(tag, 'Type');
    const target = attribute(tag, 'Target');
    if (type?.endsWith(THUMBNAIL_TYPE) && target && attribute(tag, 'TargetMode') !== 'External') {
      const name = target.replace(/^\/+/, '');
      // A part inside the package, never a way out of it.
      return name.split('/').some((part) => part === '..' || part === '') ? null : name;
    }
  }
  return null;
}

/**
 * Finds a thumbnail's entry in an archive.
 *
 * @param bytes - The archive.
 * @param entries - Its entries.
 * @param limits - What it may cost.
 * @returns The thumbnail's entry, or `null` without one.
 */
function thumbnailEntry(
  bytes: Uint8Array,
  entries: readonly ZipEntry[],
  limits: ZipLimits,
): ZipEntry | null {
  /**
   * An entry by its name.
   *
   * @param name - Its name.
   * @returns The entry, or `null` without one.
   */
  const byName = (name: string) => entries.find((entry) => entry.name === name) ?? null;
  const odf = byName(ODF_THUMBNAIL);
  if (odf) {
    return odf;
  }
  const rels = byName(PACKAGE_RELATIONSHIPS);
  const text = rels
    ? readZipEntry(bytes, rels, { ...limits, maxUnpacked: MAX_RELATIONSHIPS_BYTES })
    : null;
  const target = text ? thumbnailTarget(new TextDecoder().decode(text)) : null;
  return target ? byName(target) : null;
}

/**
 * Draws the preview of an Office or OpenDocument file from the thumbnail it
 * carries.
 *
 * @param bytes - The file.
 * @param limits - What reading it may cost; {@link OFFICE_LIMITS} by default.
 * @returns The preview as WebP, or `null` without a thumbnail it can draw.
 */
export default async function drawOfficeThumbnail(
  bytes: Uint8Array,
  limits: ZipLimits = OFFICE_LIMITS,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const entries = listZipEntries(bytes, limits);
  const entry = entries ? thumbnailEntry(bytes, entries, limits) : null;
  const thumbnail = entry ? readZipEntry(bytes, entry, limits) : null;
  return thumbnail ? drawImage({ bytes: thumbnail, checks: THUMBNAIL_CHECKS }) : null;
}
