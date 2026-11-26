/**
 * @file Tests for `/favicon.ico`: the brand's icon as an `.ico`, kept
 * briefly, or a redirect to Adiutor's own while nothing was uploaded.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { icoOf, loadBrandIcon } from '@/server/branding';

import { GET } from './route';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  /** Outside Next.js, there's no request to wait for. */
  connection: vi.fn(async () => {}),
}));
vi.mock('@/db', () => ({ db: { name: 'database' } }));
vi.mock('@/server/branding', () => ({
  loadBrandIcon: vi.fn(),
  icoOf: vi.fn(() => new Uint8Array([0, 0, 1, 0, 1, 0])),
}));

beforeEach(() => {
  vi.mocked(loadBrandIcon).mockReset();
});

describe('GET /favicon.ico', () => {
  it('serves the brand’s 32-pixel icon as an .ico, kept briefly', async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    vi.mocked(loadBrandIcon).mockResolvedValue({ version: 'icon-1', png });

    const response = await GET();

    expect(loadBrandIcon).toHaveBeenCalledExactlyOnceWith({ name: 'database' }, 32);
    expect(icoOf).toHaveBeenCalledExactlyOnceWith(png, 32);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 0, 1, 0, 1, 0]);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/x-icon',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    });
  });

  it('sends the browser to Adiutor’s own .ico while nothing was uploaded', async () => {
    vi.mocked(loadBrandIcon).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/brand/favicon.ico');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });
});
