/**
 * @file Small zip archives written by hand, for the tests of attachments'
 * previews (Office and OpenDocument files are zip archives), so no test
 * needs a file of its own; and ones that bend the format to test a reader's
 * limits.
 */
import { crc32, deflateRawSync } from 'node:zlib';

/** A file to put in an archive. */
export interface ZipFile {
  /** Its name, a path in the archive. */
  name: string;
  /** Its content. */
  data: Uint8Array | string;
  /** Whether it's deflated (stored otherwise). */
  deflate?: boolean;
  /** Its general-purpose flags (1: encrypted). */
  flags?: number;
  /** A size to claim unpacked, instead of its own. */
  claimedSize?: number;
}

/**
 * Writes a zip archive.
 *
 * @param files - Its files, in order.
 * @param options - How it bends the format.
 * @param options.count - An entry count to claim in the end record (`0xffff` says zip64).
 * @returns The archive.
 */
export function zipOf(
  files: ZipFile[],
  { count }: { count?: number } = {},
): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.data);
    const packed = file.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(file.name, 'latin1');
    const crc = crc32(data);
    const size = file.claimedSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.flags ?? 0, 6);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(file.flags ?? 0, 8);
    central.writeUInt16LE(file.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count ?? files.length, 8);
  end.writeUInt16LE(count ?? files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/**
 * An Office file's package relationships, naming its thumbnail.
 *
 * @param target - Where the thumbnail is.
 * @returns `_rels/.rels`.
 */
export function officeRelationships(target: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="${target}"/>`,
    '</Relationships>',
  ].join('');
}
