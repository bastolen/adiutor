/**
 * @file Tests for serving an attached file: a download under its name that
 * nothing sniffs, embeds elsewhere or keeps, "not found" for anything the
 * reader may not have, and an unavailable storage told by its kind only.
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

/**
 * Asks for a file, as a browser does.
 *
 * @returns The answer.
 */
function download() {
  return GET({} as NextRequest, { params: Promise.resolve({ id: ID }) });
}

/**
 * A file the reader may download, as `loadAttachment` gives it.
 *
 * @param readFile - What reading it from the storage gives.
 * @returns The file.
 */
function servable(readFile: AttachmentToServe['readFile']): AttachmentToServe {
  return { name: 'Café menu.pdf', contentType: 'application/pdf', readFile };
}

beforeEach(() => {
  vi.mocked(loadAttachment).mockReset();
});

describe('GET /attachments/[id]', () => {
  it('serves the file as a download under its name, never kept or sniffed', async () => {
    vi.mocked(loadAttachment).mockResolvedValue(
      servable(async () => ({
        body: new Response('%PDF-1.7').body ?? new ReadableStream(),
        size: 8,
      })),
    );

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
      'cache-control': 'no-store',
    });
  });

  it('answers 404 for a file the reader may not have, or that isn’t there', async () => {
    vi.mocked(loadAttachment).mockResolvedValue(null);
    const response = await download();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
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
    expect((await download()).status).toBe(503);
    expect(error).toHaveBeenCalledWith(
      'An attachment could not be read from the storage:',
      'timed_out',
    );
    error.mockRestore();
  });
});
