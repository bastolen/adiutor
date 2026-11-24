/**
 * @file Tests for telling a confirmation page's own Continue (a form `POST`
 * a page of this site sent as a page load) from anything else.
 */
import { describe, expect, it, vi } from 'vitest';

import isOwnPagePost from './own-page-post';

vi.mock('@/lib/env', () => ({ appUrl: 'https://adiutor.dev/' }));

/** A page load that a page of this site started: the page's form, pressed or sent by itself. */
const PAGE_LOAD = {
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

/**
 * Checks headers as a `POST`.
 *
 * @param headers - The request's headers.
 * @returns Whether they make it the page's own `POST`.
 */
function posted(headers: Record<string, string>): boolean {
  return isOwnPagePost(new Headers(headers), true);
}

describe('isOwnPagePost', () => {
  it("takes a page load from the site's own page, without a click header (Safari)", () => {
    expect(posted(PAGE_LOAD)).toBe(true);
    expect(posted({ ...PAGE_LOAD, 'sec-fetch-user': '?1' })).toBe(true);
  });

  it('never takes a GET, whatever its headers: a link, even one on a page of the site', () => {
    expect(isOwnPagePost(new Headers({ ...PAGE_LOAD, 'sec-fetch-user': '?1' }), false)).toBe(false);
    expect(isOwnPagePost(new Headers({ origin: 'https://adiutor.dev' }), false)).toBe(false);
  });

  it.each([
    ['from another site', { ...PAGE_LOAD, 'sec-fetch-site': 'cross-site' }],
    ['from a sister site', { ...PAGE_LOAD, 'sec-fetch-site': 'same-site' }],
    ['typed in or from outside a page', { ...PAGE_LOAD, 'sec-fetch-site': 'none' }],
    [
      "from the site's own script, not a page load",
      { ...PAGE_LOAD, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    ],
    ['in a frame', { ...PAGE_LOAD, 'sec-fetch-dest': 'iframe' }],
  ])("doesn't take a POST %s", (_case, headers) => {
    expect(posted(headers)).toBe(false);
  });

  it("takes the site's exact origin from a browser that sends none of the headers", () => {
    expect(posted({ origin: 'https://adiutor.dev' })).toBe(true);
  });

  it.each([
    ['nothing at all', {}],
    ['another origin', { origin: 'https://mail.adiutor.test' }],
    ['an origin of null', { origin: 'null' }],
    ["the site's origin with a path", { origin: 'https://adiutor.dev/' }],
    ["an origin that starts with the site's", { origin: 'https://adiutor.dev.mail.adiutor.test' }],
    ['only a referrer from the page', { referer: 'https://adiutor.dev/auth/email-link' }],
  ])('without the headers, refuses %s', (_case, headers) => {
    expect(posted(headers)).toBe(false);
  });

  it('lets the headers decide alone once any is sent, even empty, whatever the origin', () => {
    expect(posted({ origin: 'https://adiutor.dev', 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(posted({ origin: 'https://adiutor.dev', 'sec-fetch-dest': 'iframe' })).toBe(false);
    expect(posted({ origin: 'https://adiutor.dev', 'sec-fetch-site': '' })).toBe(false);
    expect(posted({ ...PAGE_LOAD, origin: 'https://mail.adiutor.test' })).toBe(true);
  });
});
