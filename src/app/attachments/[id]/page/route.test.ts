/**
 * @file Tests for serving a PDF's large first page: a WebP download under
 * the PDF's name with the file's checks and caching, and "not found" for a
 * file that isn't a PDF with a preview, one drawn before pages were, or one
 * the reader may not have.
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

/**
 * Asks for a PDF's page, as the viewer's image does.
 *
 * @param ifNoneMatch - The tag of the copy the browser kept, if any.
 * @returns The answer.
 */
function page(ifNoneMatch?: string) {
  const headers = new Headers(ifNoneMatch === undefined ? {} : { 'If-None-Match': ifNoneMatch });
  return GET({ headers } as NextRequest, { params: Promise.resolve({ id: ID }) });
}

/**
 * A file the reader may read, as `loadAttachment` gives it.
 *
 * @param values - What differs from a PDF with a preview and a page.
 * @returns The file.
 */
function servable(values: Partial<AttachmentToServe> = {}): AttachmentToServe {
  return {
    name: 'Café menu.pdf',
    contentType: 'application/pdf',
    readFile: vi.fn(),
    readFilePart: vi.fn(),
    hasPreview: true,
    readPreview: vi.fn(),
    readPage: vi.fn(async () => ({
      body: new Response('RIFF....WEBP').body ?? new ReadableStream(),
      size: 12,
    })),
    ...values,
  };
}

beforeEach(() => {
  vi.mocked(loadAttachment).mockReset();
});

describe('GET /attachments/[id]/page', () => {
  it('serves a PDF’s page as WebP, a download under the PDF’s name, checked each time', async () => {
    vi.mocked(loadAttachment).mockResolvedValue(servable());

    const response = await page();

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/webp',
      'content-disposition':
        'attachment; filename="Cafe menu.webp"; filename*=UTF-8\'\'Caf%C3%A9%20menu.webp',
      etag: `"${ID}-page"`,
      'cache-control': 'private, no-cache',
    });
    expect((await page(`"${ID}-page"`)).status).toBe(304);
  });

  it('answers 404 for a file that isn’t a PDF with a preview, or a PDF drawn before pages', async () => {
    for (const file of [
      servable({ contentType: 'image/png' }),
      servable({ hasPreview: false }),
      servable({ readPage: vi.fn(async () => null) }),
      null,
    ]) {
      vi.mocked(loadAttachment).mockResolvedValue(file);
      // eslint-disable-next-line no-await-in-loop -- One answer at a time, each checked.
      const response = await page();
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
