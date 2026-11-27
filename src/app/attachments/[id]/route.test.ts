/**
 * @file Tests for serving an attached file: a download under its name that
 * nothing sniffs or embeds elsewhere, kept only by the reader's browser,
 * which asks before each use and gets `304` without the storage being read;
 * "not found" for anything the reader may not have, whatever copy the
 * browser kept; and an unavailable storage told by its kind only.
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActor } from '@/server/authz';
import { type AttachmentToServe, loadAttachment } from '@/server/requests';
import { StorageError } from '@/server/storage';

import { GET } from './route';

vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.test', env: {} }));
vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getActor: vi.fn(async () => ({ id: 'user-id' })) }));
vi.mock('@/server/requests', () => ({ loadAttachment: vi.fn() }));

/** An attachment's ID. */
const ID = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

/** Its entity tag. */
const ETAG = `"${ID}"`;

/**
 * Asks for a file, as a browser does.
 *
 * @param ifNoneMatch - The tag of the copy the browser kept, if any.
 * @returns The answer.
 */
function download(ifNoneMatch?: string) {
  const headers = new Headers(ifNoneMatch === undefined ? {} : { 'If-None-Match': ifNoneMatch });
  return GET({ headers } as NextRequest, { params: Promise.resolve({ id: ID }) });
}

/**
 * A file the reader may download, as `loadAttachment` gives it.
 *
 * @param readFile - What reading it from the storage gives.
 * @returns The file.
 */
function servable(
  readFile: AttachmentToServe['readFile'] = vi.fn(async () => ({
    body: new Response('%PDF-1.7').body ?? new ReadableStream(),
    size: 8,
  })),
): AttachmentToServe {
  return {
    name: 'Café menu.pdf',
    contentType: 'application/pdf',
    readFile,
    hasPreview: true,
    readPreview: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(loadAttachment).mockReset();
});

describe('GET /attachments/[id]', () => {
  it('serves the file as a download under its name, kept privately and checked each time', async () => {
    vi.mocked(loadAttachment).mockResolvedValue(servable());

    const response = await download();

    expect(loadAttachment).toHaveBeenCalledExactlyOnceWith(
      { name: 'app context' },
      { id: 'user-id' },
      ID,
    );
    expect(getActor).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('%PDF-1.7');
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/pdf',
      // So the browser shows how far a large download is.
      'content-length': '8',
      'content-disposition':
        'attachment; filename="Cafe menu.pdf"; filename*=UTF-8\'\'Caf%C3%A9%20menu.pdf',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      etag: ETAG,
      'cache-control': 'private, no-cache',
    });
  });

  it.each([ETAG, `W/${ETAG}`, `"another", ${ETAG}`])(
    'answers 304 to a browser whose copy is the file (%s), without reading the storage',
    async (ifNoneMatch) => {
      const file = servable();
      vi.mocked(loadAttachment).mockResolvedValue(file);

      const response = await download(ifNoneMatch);

      // The reader is checked all the same.
      expect(loadAttachment).toHaveBeenCalledOnce();
      expect(file.readFile).not.toHaveBeenCalled();
      expect(response.status).toBe(304);
      expect(response.body).toBeNull();
      expect(Object.fromEntries(response.headers)).toEqual({
        etag: ETAG,
        'cache-control': 'private, no-cache',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
      });
    },
  );

  it('serves the file to a browser whose copy is another one', async () => {
    const file = servable();
    vi.mocked(loadAttachment).mockResolvedValue(file);

    const response = await download('"0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3b"');

    expect(response.status).toBe(200);
    expect(file.readFile).toHaveBeenCalledOnce();
  });

  it('answers 404 for a file the reader may not have, or that isn’t there, whatever the browser kept', async () => {
    vi.mocked(loadAttachment).mockResolvedValue(null);
    for (const ifNoneMatch of [undefined, ETAG]) {
      // eslint-disable-next-line no-await-in-loop -- One answer at a time, each checked.
      const response = await download(ifNoneMatch);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('etag')).toBeNull();
    }
  });

  it('answers 404 for a file the storage doesn’t have', async () => {
    vi.mocked(loadAttachment).mockResolvedValue(servable(async () => null));
    const response = await download();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 503 when the storage fails, logging only its kind', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadAttachment).mockResolvedValue(
      servable(async () => {
        throw new StorageError('timed_out');
      }),
    );
    const response = await download();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(error).toHaveBeenCalledWith(
      'An attachment could not be read from the storage:',
      'timed_out',
    );
    error.mockRestore();
  });
});
