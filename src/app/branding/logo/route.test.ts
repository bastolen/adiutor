/**
 * @file Tests for serving the uploaded logo: a PNG that nothing sniffs, kept
 * for a year at its current version and briefly otherwise, and "not found"
 * while no logo was uploaded.
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBrandImage } from '@/server/branding';

import { GET } from './route';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  /** Outside Next.js, there's no request to wait for. */
  connection: vi.fn(async () => {}),
}));
vi.mock('@/db', () => ({ db: { name: 'database' } }));
vi.mock('@/server/branding', () => ({ loadBrandImage: vi.fn() }));

/**
 * Asks for the logo, as a browser or a mail client does.
 *
 * @param query - The address's query, e.g. `?v=…`.
 * @returns The answer.
 */
function fetchLogo(query = '') {
  return GET(new NextRequest(`https://adiutor.test/branding/logo${query}`));
}

beforeEach(() => {
  vi.mocked(loadBrandImage).mockReset();
});

describe('GET /branding/logo', () => {
  it('serves the PNG, kept for a year at its current version', async () => {
    vi.mocked(loadBrandImage).mockResolvedValue({
      id: 'logo-1',
      width: 280,
      height: 64,
      content: new Uint8Array([137, 80, 78, 71]),
    });

    const response = await fetchLogo('?v=logo-1');

    expect(loadBrandImage).toHaveBeenCalledExactlyOnceWith({ name: 'database' }, 'logo');
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/png',
      'content-length': '4',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  });

  it('serves the current logo for another version or none, kept briefly', async () => {
    vi.mocked(loadBrandImage).mockResolvedValue({
      id: 'logo-2',
      width: 280,
      height: 64,
      content: new Uint8Array([137, 80, 78, 71]),
    });

    for (const query of ['?v=logo-1', '']) {
      // eslint-disable-next-line no-await-in-loop -- Two addresses, one after the other.
      const response = await fetchLogo(query);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    }
  });

  it('answers "not found", kept by nobody, while no logo was uploaded', async () => {
    vi.mocked(loadBrandImage).mockResolvedValue(null);

    const response = await fetchLogo('?v=logo-1');

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
