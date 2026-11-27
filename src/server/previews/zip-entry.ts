/**
 * @file Reads one named file out of a zip archive (an Office or OpenDocument
 * file is one): its central directory, then that entry only. Built for
 * untrusted archives, so it reads only what it must and refuses anything
 * past its limits (`ZIP_LIMITS`): too many entries, an entry too large
 * packed or unpacked, one that unpacks to more than it says, encryption,
 * archives split over disks or in the zip64 format, and any packing but
 * stored or deflated. Node's own zlib unpacks.
 */
import { crc32, inflateRawSync } from 'node:zlib';

/** What a zip archive may cost to read. */
export interface ZipLimits {
  /** The most entries its directory may list. */
  maxEntries: number;
  /** The largest an entry read may be, packed, in bytes. */
  maxPacked: number;
  /** The largest an entry read may be, unpacked, in bytes. */
  maxUnpacked: number;
}

/** An entry, as the central directory lists it. */
export interface ZipEntry {
  /** Its name, a path in the archive. */
  name: string;
  /** Its general-purpose flags. */
  flags: number;
  /** How it's packed: 0 stored, 8 deflated. */
  method: number;
  /** Its checksum. */
  crc: number;
  /** Its size packed, in bytes. */
  packedSize: number;
  /** Its size unpacked, in bytes. */
  size: number;
  /** Where its local header starts. */
  offset: number;
}

/** The end of the central directory's signature, `PK\x05\x06`. */
const END_SIGNATURE = 0x06054b50;

/** A central directory header's signature, `PK\x01\x02`. */
const ENTRY_SIGNATURE = 0x02014b50;

/** A local file header's signature, `PK\x03\x04`. */
const LOCAL_SIGNATURE = 0x04034b50;

/** The size of the end of the central directory, without its comment. */
const END_SIZE = 22;

/** The longest comment the end of the central directory may have. */
const MAX_COMMENT = 0xffff;

/** A count or size that says the real one is in a zip64 record. */
const ZIP64_COUNT = 0xffff;
const ZIP64_SIZE = 0xffffffff;

/** The flag of an encrypted entry. */
const ENCRYPTED = 0x1;

/** The packing methods read: stored, and deflated. */
const STORED = 0;
const DEFLATED = 8;

/**
 * Finds the end of the central directory, searching back from the end of
 * the archive past a comment of any length.
 *
 * @param view - The archive.
 * @returns Where it starts, or `-1` without one.
 */
function findEnd(view: DataView): number {
  const last = view.byteLength - END_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let at = last; at >= first; at -= 1) {
    if (view.getUint32(at, true) === END_SIGNATURE) {
      return at;
    }
  }
  return -1;
}

/**
 * Lists the entries of an archive, from its central directory.
 *
 * @param bytes - The archive.
 * @param limits - What it may cost.
 * @returns Its entries, or `null` when it isn't an archive this reads.
 */
export function listZipEntries(bytes: Uint8Array, limits: ZipLimits): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < END_SIZE) {
    return null;
  }
  const end = findEnd(view);
  if (end < 0) {
    return null;
  }
  const disk = view.getUint16(end + 4, true);
  const directoryDisk = view.getUint16(end + 6, true);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    count === ZIP64_COUNT ||
    directorySize === ZIP64_SIZE ||
    directoryOffset === ZIP64_SIZE ||
    count > limits.maxEntries ||
    directoryOffset + directorySize > end
  ) {
    return null;
  }
  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== ENTRY_SIGNATURE) {
      return null;
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end) {
      return null;
    }
    entries.push({
      name: new TextDecoder('latin1').decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      packedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at = next;
  }
  return entries;
}

/**
 * Reads one entry of an archive, unpacked.
 *
 * @param bytes - The archive.
 * @param entry - The entry, from {@link listZipEntries}.
 * @param limits - What it may cost.
 * @returns Its bytes, or `null` when it's past a limit, packed in a way this doesn't read,
 *   encrypted, or broken.
 */
export function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  limits: ZipLimits,
): Uint8Array | null {
  if (
    // eslint-disable-next-line no-bitwise -- One flag of the entry's flags.
    (entry.flags & ENCRYPTED) !== 0 ||
    (entry.method !== STORED && entry.method !== DEFLATED) ||
    entry.packedSize > limits.maxPacked ||
    entry.size > limits.maxUnpacked ||
    entry.packedSize === ZIP64_SIZE ||
    entry.size === ZIP64_SIZE ||
    entry.offset === ZIP64_SIZE
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    entry.offset + 30 > view.byteLength ||
    view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE
  ) {
    return null;
  }
  const start =
    entry.offset +
    30 +
    view.getUint16(entry.offset + 26, true) +
    view.getUint16(entry.offset + 28, true);
  if (start + entry.packedSize > view.byteLength) {
    return null;
  }
  const packed = bytes.subarray(start, start + entry.packedSize);
  let unpacked: Uint8Array;
  if (entry.method === STORED) {
    unpacked = packed;
  } else {
    try {
      // Never more than the entry says it holds: an archive that lies about it is refused.
      unpacked = inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      return null;
    }
  }
  if (unpacked.byteLength !== entry.size || crc32(unpacked) !== entry.crc) {
    return null;
  }
  return unpacked;
}
