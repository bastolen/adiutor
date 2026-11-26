/**
 * @file Tests for telling a request a page of this site sent with `fetch`
 * from one another site made the browser send.
 */
import { describe, expect, it, vi } from 'vitest';

import isOwnPageFetch from './own-page-fetch';

vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.dev/' }));

/**
 * Checks a request's headers.
 *
 * @param headers - The headers.
 * @returns Whether a page of this site sent it.
 */
function fromOwnPage(headers: Record<string, string>): boolean {
  return isOwnPageFetch(new Headers(headers));
}

describe('isOwnPageFetch', () => {
  it('takes a fetch from one of its pages, as Fetch Metadata says', () => {
    expect(fromOwnPage({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })).toBe(true);
  });

  it('refuses one another site, or anything else, sent', () => {
    for (const site of ['cross-site', 'same-site', 'none', '']) {
      expect(fromOwnPage({ 'sec-fetch-site': site, origin: 'https://adiutor.dev' }), site).toBe(
        false,
      );
    }
  });

  it('checks the origin when the browser sends no Fetch Metadata', () => {
    expect(fromOwnPage({ origin: 'https://adiutor.dev' })).toBe(true);
    expect(fromOwnPage({ origin: 'https://adiutor.dev.evil.test' })).toBe(false);
    expect(fromOwnPage({ origin: 'null' })).toBe(false);
    expect(fromOwnPage({ referer: 'https://adiutor.dev/requests/1' })).toBe(false);
    expect(fromOwnPage({})).toBe(false);
  });
});
