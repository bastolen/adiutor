/**
 * @file Tests for reading one file out of a zip archive: stored and deflated
 * entries, and `null` for what's past a limit or bends the format (too many
 * entries, zip64, encryption, an entry that unpacks to more than it says or
 * whose checksum is wrong, a cut-off archive).
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { zipOf } from '../../../tests/files/zips';
import { listZipEntries, readZipEntry, type ZipLimits } from './zip-entry';

/** Room enough for every test archive. */
const LIMITS: ZipLimits = { maxEntries: 10, maxPacked: 10_000, maxUnpacked: 100_000 };

/**
 * Reads an entry of an archive by name.
 *
 * @param archive - The archive.
 * @param name - The entry's name.
 * @param limits - What it may cost.
 * @returns Its text, or `null`.
 */
function read(archive: Uint8Array, name: string, limits = LIMITS): string | null {
  const entry = listZipEntries(archive, limits)?.find((listed) => listed.name === name);
  const bytes = entry ? readZipEntry(archive, entry, limits) : null;
  return bytes ? new TextDecoder().decode(bytes) : null;
}

describe('zip entries', () => {
  it('reads a stored entry and a deflated one, by name', () => {
    const archive = zipOf([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
      { name: 'content.xml', data: '<office:document/>'.repeat(50), deflate: true },
    ]);
    expect(listZipEntries(archive, LIMITS)?.map((entry) => entry.name)).toEqual([
      'mimetype',
      'content.xml',
    ]);
    expect(read(archive, 'mimetype')).toBe('application/vnd.oasis.opendocument.text');
    expect(read(archive, 'content.xml')).toBe('<office:document/>'.repeat(50));
  });

  it('refuses an archive with too many entries, or one in the zip64 format', () => {
    const many = zipOf(Array.from({ length: 11 }, (_, index) => ({ name: `${index}`, data: 'x' })));
    expect(listZipEntries(many, LIMITS)).toBeNull();
    expect(listZipEntries(zipOf([{ name: 'a', data: 'x' }], { count: 0xffff }), LIMITS)).toBeNull();
  });

  it('refuses an entry past the size limits, or that unpacks to more than it says', () => {
    const big = zipOf([{ name: 'big', data: 'x'.repeat(200_000), deflate: true }]);
    expect(read(big, 'big')).toBeNull();
    // A bomb: it says it holds 100 bytes, and unpacks to far more.
    const bomb = zipOf([
      { name: 'bomb', data: 'x'.repeat(90_000), deflate: true, claimedSize: 100 },
    ]);
    expect(read(bomb, 'bomb')).toBeNull();
    const packed = zipOf([{ name: 'packed', data: 'x'.repeat(20_000) }]);
    expect(read(packed, 'packed')).toBeNull();
  });

  it('refuses an encrypted entry, a wrong checksum and a cut-off archive', () => {
    expect(read(zipOf([{ name: 'secret', data: 'x', flags: 1 }]), 'secret')).toBeNull();
    const archive = zipOf([{ name: 'a.txt', data: 'printer offline' }]);
    const corrupted = archive.slice();
    // The first byte of the entry's data, after its 30-byte header and its 5-byte name.
    corrupted[35] = 0x58;
    expect(read(corrupted, 'a.txt')).toBeNull();
    expect(listZipEntries(archive.subarray(0, archive.length - 30), LIMITS)).toBeNull();
    expect(listZipEntries(new TextEncoder().encode('PK not really'), LIMITS)).toBeNull();
  });
});
