/**
 * @file Tests for an Office or OpenDocument file's own thumbnail: an
 * OpenDocument file's PNG, an Office file's JPEG named by its package's
 * relationships, and `null` without one, for a WMF thumbnail, or for a
 * relationship that points out of the package.
 * @vitest-environment node
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { officeRelationships, zipOf } from '../../../tests/files/zips';
import drawOfficeThumbnail, { thumbnailTarget } from './office-thumbnail';

/**
 * A small image, as a program that saves documents draws one.
 *
 * @param format - PNG or JPEG.
 * @returns Its bytes.
 */
async function thumbnail(format: 'png' | 'jpeg'): Promise<Uint8Array> {
  const image = sharp({ create: { width: 181, height: 256, channels: 3, background: '#f4f4f4' } });
  return new Uint8Array(await (format === 'png' ? image.png() : image.jpeg()).toBuffer());
}

/**
 * The size of a preview.
 *
 * @param webp - The preview.
 * @returns Its width and height.
 */
async function sizeOf(webp: Uint8Array | null) {
  const { width, height, format } = await sharp(webp ?? new Uint8Array()).metadata();
  return { width, height, format };
}

describe('drawOfficeThumbnail', () => {
  it('draws the thumbnail an OpenDocument file keeps', async () => {
    const odt = zipOf([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
      { name: 'content.xml', data: '<office:document-content/>', deflate: true },
      { name: 'Thumbnails/thumbnail.png', data: await thumbnail('png') },
    ]);
    expect(await sizeOf(await drawOfficeThumbnail(odt))).toEqual({
      width: 181,
      height: 256,
      format: 'webp',
    });
  });

  it('draws the thumbnail an Office file’s relationships name', async () => {
    const docx = zipOf([
      { name: '[Content_Types].xml', data: '<Types/>', deflate: true },
      { name: '_rels/.rels', data: officeRelationships('/docProps/thumbnail.jpeg'), deflate: true },
      { name: 'word/document.xml', data: '<w:document/>', deflate: true },
      { name: 'docProps/thumbnail.jpeg', data: await thumbnail('jpeg') },
    ]);
    expect((await sizeOf(await drawOfficeThumbnail(docx))).height).toBe(256);
  });

  it('gives nothing for a file without a thumbnail, or with a WMF one', async () => {
    const plain = zipOf([{ name: 'word/document.xml', data: '<w:document/>' }]);
    expect(await drawOfficeThumbnail(plain)).toBeNull();
    const wmf = zipOf([
      { name: '_rels/.rels', data: officeRelationships('docProps/thumbnail.wmf') },
      { name: 'docProps/thumbnail.wmf', data: new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0, 0]) },
    ]);
    expect(await drawOfficeThumbnail(wmf)).toBeNull();
    expect(await drawOfficeThumbnail(new TextEncoder().encode('not a zip'))).toBeNull();
  });
});

describe('thumbnailTarget', () => {
  it('finds the thumbnail’s part, in either quote and namespace', () => {
    expect(thumbnailTarget(officeRelationships('/docProps/thumbnail.jpeg'))).toBe(
      'docProps/thumbnail.jpeg',
    );
    expect(
      thumbnailTarget(
        "<pr:Relationship Target='docProps/t.png' Type='http://purl.oclc.org/ooxml/package/relationships/metadata/thumbnail' Id='r'/>",
      ),
    ).toBe('docProps/t.png');
  });

  it('never points out of the package, or outside it', () => {
    expect(thumbnailTarget(officeRelationships('../outside.png'))).toBeNull();
    expect(thumbnailTarget(officeRelationships('docProps//t.png'))).toBeNull();
    expect(
      thumbnailTarget(
        '<Relationship Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="https://adiutor.dev/t.png" TargetMode="External"/>',
      ),
    ).toBeNull();
    expect(thumbnailTarget('<Relationships/>')).toBeNull();
  });
});
