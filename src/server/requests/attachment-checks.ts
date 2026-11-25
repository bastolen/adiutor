/**
 * @file Whether a file's bytes are what its extension says (decision 0044):
 * the signature each kind of file starts with, and for text, valid UTF-8 or
 * UTF-16 throughout without NUL characters. A file that fails is refused, so
 * an HTML page named `.png` or a program named `.txt` is never stored.
 * Every file is still served as a download that runs nothing; this keeps
 * what's stored to what it claims to be.
 */
import type { AttachmentCheck } from '@/lib/requests';

/** The brands of an ISO media file (`ftyp`) that are HEIC or HEIF images. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** QuickTime's own brand, and the boxes an older QuickTime file may start with. */
const QUICKTIME_BRAND = 'qt  ';
const QUICKTIME_BOXES = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

/** How far into a PDF its header may start (the format allows junk before it). */
const PDF_HEADER_WITHIN = 1024;

/**
 * Whether bytes start with others.
 *
 * @param bytes - The file.
 * @param prefix - What it should start with.
 * @param offset - Where to look.
 * @returns Whether it does.
 */
function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Four bytes as text (a box type or a brand).
 *
 * @param bytes - The file.
 * @param offset - Where they start.
 * @returns The four characters.
 */
function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/**
 * The brand of an ISO media file (MP4, HEIC, QuickTime): an `ftyp` box first.
 *
 * @param bytes - The file.
 * @returns Its major brand, or `null` without an `ftyp` box.
 */
function isoBrand(bytes: Uint8Array): string | null {
  return bytes.length >= 12 && fourCc(bytes, 4) === 'ftyp' ? fourCc(bytes, 8) : null;
}

/**
 * Whether bytes are text: UTF-16 after its byte order mark (an even length,
 * surrogates in pairs, no U+0000), or else UTF-8, with or without its mark,
 * valid throughout and without a NUL byte.
 *
 * @param bytes - The file.
 * @returns Whether it's text.
 */
function isText(bytes: Uint8Array): boolean {
  const littleEndian = startsWith(bytes, [0xff, 0xfe]);
  if (littleEndian || startsWith(bytes, [0xfe, 0xff])) {
    if (bytes.length % 2 !== 0) {
      return false;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let highSurrogate = false;
    for (let index = 2; index < bytes.length; index += 2) {
      const unit = view.getUint16(index, littleEndian);
      const isHigh = unit >= 0xd800 && unit <= 0xdbff;
      const isLow = unit >= 0xdc00 && unit <= 0xdfff;
      if (unit === 0 || isLow !== highSurrogate) {
        return false;
      }
      highSurrogate = isHigh;
    }
    return !highSurrogate;
  }
  if (bytes.includes(0)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a file's bytes are the kind its extension says.
 *
 * @param kind - How its type is checked (`ATTACHMENT_TYPES`).
 * @param bytes - The whole file.
 * @returns Whether it passes.
 */
export default function matchesAttachmentKind(kind: AttachmentCheck, bytes: Uint8Array): boolean {
  switch (kind) {
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'gif':
      return ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.subarray(0, 6)));
    case 'webp':
      return fourCc(bytes, 0) === 'RIFF' && fourCc(bytes, 8) === 'WEBP';
    case 'heic': {
      const brand = isoBrand(bytes);
      return brand !== null && HEIC_BRANDS.has(brand);
    }
    case 'pdf':
      return new TextDecoder('latin1')
        .decode(bytes.subarray(0, PDF_HEADER_WITHIN + 5))
        .includes('%PDF-');
    case 'text':
      return isText(bytes);
    case 'zip':
      // A file's header, or an empty archive's end record.
      return (
        startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
      );
    case '7z':
      return startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    case 'gzip':
      return startsWith(bytes, [0x1f, 0x8b, 0x08]);
    case 'mp4': {
      const brand = isoBrand(bytes);
      return brand !== null && !HEIC_BRANDS.has(brand) && brand !== QUICKTIME_BRAND;
    }
    case 'mov':
      return isoBrand(bytes) === QUICKTIME_BRAND || QUICKTIME_BOXES.has(fourCc(bytes, 4));
    case 'webm':
      // EBML, with "webm" as its document type near the start.
      return (
        startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) &&
        new TextDecoder('latin1').decode(bytes.subarray(0, 64)).includes('webm')
      );
    default:
      return false;
  }
}
