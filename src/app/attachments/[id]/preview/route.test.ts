/**
 * @file Tests for serving a file's preview: a WebP download under the
 * file's name, with the file's own checks and caching (`304` without the
 * storage being read, after the checks), and "not found" for a file without
 * a preview or one the reader may not have.
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AttachmentToServe, loadAttachment } from '@/server/requests';

import { GET } from './route';

vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.test', env: {} }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn(async () => ({ id: 'user-id' })) }));
vi.mock('@/server/requests', () => ({ loadAttachment: vi.fn() }));

/** An attachment's ID. */
const ID = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

/** Its preview's entity tag. */
const ETAG = `"${ID}-preview"`;

/**
 * Asks for a preview, as a tile's image does.
 *
 * @param ifNoneMatch - The tag of the copy the browser kept, if any.
 * @returns The answer.
 */
function preview(ifNoneMatch?: string) {
  const headers = new Headers(ifNoneMatch === undefined ? {} : { 'If-None-Match': ifNoneMatch });
  return GET({ headers } as NextRequest, { params: Promise.resolve({ id: ID }) });
}

/**
 * A file the reader may read, as `loadAttachment` gives it.
 *
 * @param hasPreview - Whether it has a preview.
 * @returns The file.
 */
function servable(hasPreview = true): AttachmentToServe {
  return {
    name: 'Café menu.pdf',
    contentType: 'application/pdf',
    readFile: vi.fn(),
    readFilePart: vi.fn(),
    readPage: vi.fn(),
    hasPreview,
    readPreview: vi.fn(async () => ({
      body: new Response('RIFF....WEBP').body ?? new ReadableStream(),
      size: 12,
    })),
  };
}

beforeEach(() => {
  vi.mocked(loadAttachment).mockReset();
});

describe('GET /attachments/[id]/preview', () => {
  it('serves the preview as WebP, a download under the file’s name, kept privately', async () => {
    const file = servable();
    vi.mocked(loadAttachment).mockResolvedValue(file);

    const response = await preview();

    expect(loadAttachment).toHaveBeenCalledExactlyOnceWith(
      { name: 'app context' },
      { id: 'user-id' },
      ID,
    );
    expect(file.readFile).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('RIFF....WEBP');
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/webp',
      'content-disposition':
        'attachment; filename="Cafe menu.webp"; filename*=UTF-8\'\'Caf%C3%A9%20menu.webp',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      etag: ETAG,
      'cache-control': 'private, no-cache',
    });
  });

  it('answers 304 to a browser whose copy is the preview, after the checks, without reading it', async () => {
    const file = servable();
    vi.mocked(loadAttachment).mockResolvedValue(file);

    const response = await preview(ETAG);

    expect(loadAttachment).toHaveBeenCalledOnce();
    expect(file.readPreview).not.toHaveBeenCalled();
    expect(response.status).toBe(304);
  });

  it('never takes the file’s own tag for the preview’s', async () => {
    const file = servable();
    vi.mocked(loadAttachment).mockResolvedValue(file);

    const response = await preview(`"${ID}"`);

    expect(response.status).toBe(200);
    expect(file.readPreview).toHaveBeenCalledOnce();
  });

  it('answers 404 for a file without a preview, or one the reader may not have', async () => {
    for (const file of [servable(false), null]) {
      vi.mocked(loadAttachment).mockResolvedValue(file);
      for (const ifNoneMatch of [undefined, ETAG]) {
        // eslint-disable-next-line no-await-in-loop -- One answer at a time, each checked.
        const response = await preview(ifNoneMatch);
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('etag')).toBeNull();
      }
    }
  });
});
