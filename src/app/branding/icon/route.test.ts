/**
 * @file Tests for serving the browser tab icon made from the brand: at the
 * size asked for, kept for a year at its current version, and "not found"
 * while it's Adiutor's own.
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBrandIcon } from '@/server/branding';

import { GET } from './route';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  /** Outside Next.js, there's no request to wait for. */
  connection: vi.fn(async () => {}),
}));
vi.mock('@/db', () => ({ db: { name: 'database' } }));
vi.mock('@/server/branding', () => ({ loadBrandIcon: vi.fn() }));

/**
 * Asks for the icon, as a browser does.
 *
 * @param query - The address's query.
 * @returns The answer.
 */
function fetchIcon(query: string) {
  return GET(new NextRequest(`https://adiutor.test/branding/icon${query}`));
}

beforeEach(() => {
  vi.mocked(loadBrandIcon).mockReset();
  vi.mocked(loadBrandIcon).mockResolvedValue({
    version: 'icon-1',
    png: new Uint8Array([137, 80, 78, 71]),
  });
});

describe('GET /branding/icon', () => {
  it('serves a browser tab’s icon, kept for a year at its current version', async () => {
    const response = await fetchIcon('?v=icon-1');

    expect(loadBrandIcon).toHaveBeenCalledExactlyOnceWith({ name: 'database' }, 32);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  });

  it('serves an Apple touch icon when asked, and a tab’s for any other size', async () => {
    await fetchIcon('?size=180&v=icon-1');
    await fetchIcon('?size=4096&v=icon-1');

    expect(vi.mocked(loadBrandIcon).mock.calls.map(([, size]) => size)).toEqual([180, 32]);
  });

  it('keeps another version briefly', async () => {
    expect((await fetchIcon('?v=icon-0')).headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('answers "not found" while the icon is Adiutor’s own', async () => {
    vi.mocked(loadBrandIcon).mockResolvedValue(null);

    expect((await fetchIcon('?v=icon-1')).status).toBe(404);
  });
});
