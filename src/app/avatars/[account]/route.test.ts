/**
 * @file Tests for serving a person's picture: only to someone signed in, as
 * the picture service decides for them, kept privately for a day and never
 * sniffed, and "not found" for anything else.
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor } from '@/server/actor';
import { getOptionalActor } from '@/server/authz';
import { loadPicture } from '@/server/people/pictures';

import { GET } from './route';

vi.mock('@/server/app-context', () => ({ default: { name: 'app context' } }));
vi.mock('@/server/authz', () => ({ getOptionalActor: vi.fn() }));
vi.mock('@/server/people/pictures', () => ({ loadPicture: vi.fn() }));

/** An account's ID. */
const ACCOUNT = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a';

/** The signed-in viewer, as far as the route sees them. */
const VIEWER = { id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3b' } as Actor;

/** A tiny PNG's first bytes. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Asks for a picture, as a browser does.
 *
 * @returns The answer.
 */
function askForPicture() {
  return GET({} as NextRequest, { params: Promise.resolve({ account: ACCOUNT }) });
}

beforeEach(() => {
  vi.mocked(getOptionalActor).mockReset();
  vi.mocked(loadPicture).mockReset();
});

describe('GET /avatars/[account]', () => {
  it('serves the picture for the signed-in viewer, kept privately for a day', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(VIEWER);
    vi.mocked(loadPicture).mockResolvedValue({ body: PNG, contentType: 'image/png' });

    const response = await askForPicture();

    // Who asks decides too: an owner gets the other pictures they can choose.
    expect(loadPicture).toHaveBeenCalledExactlyOnceWith({ name: 'app context' }, VIEWER, ACCOUNT);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    });
  });

  it('answers 404 to someone signed out, without loading anything', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(null);

    const response = await askForPicture();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(loadPicture).not.toHaveBeenCalled();
  });

  it('answers 404 when there’s no picture for the viewer to serve', async () => {
    vi.mocked(getOptionalActor).mockResolvedValue(VIEWER);
    vi.mocked(loadPicture).mockResolvedValue(null);

    const response = await askForPicture();

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
