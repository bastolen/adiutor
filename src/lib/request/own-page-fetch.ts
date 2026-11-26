/**
 * @file Tells a request a page of this site sent with `fetch` or
 * `XMLHttpRequest` (the attachment picker's upload) from one another site
 * made the browser send, so a route outside the proxy that changes something
 * can refuse anything but its own pages. A form's `POST` that loads a page
 * is told apart by `isOwnPagePost` instead.
 */
import { appUrl } from '@/lib/env';

/** The site's own origin, as a browser names it in a request from one of its pages (`Origin`). */
const SITE_ORIGIN = new URL(appUrl).origin;

/**
 * Checks whether a page of this site sent a request: `Sec-Fetch-Site:
 * same-origin`, which no other site can make a browser send. A browser that
 * sends no Fetch Metadata (Safari before 16.4, any browser on plain `http`
 * away from `localhost`) is checked by its `Origin`, which must be exactly
 * the site's; a missing one, `null` or a `Referer` never counts.
 *
 * @param headers - The request's headers.
 * @returns Whether one of this site's pages sent it.
 */
export default function isOwnPageFetch(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null) {
    return site === 'same-origin';
  }
  return headers.get('origin') === SITE_ORIGIN;
}
