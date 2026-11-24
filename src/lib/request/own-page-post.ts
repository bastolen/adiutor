/**
 * @file Tells the Continue of a sign-in link's confirmation page, a form
 * `POST` that a page of this site sent as a page load, from anything else
 * (another site's form, a link, an email, a typed address). The email link's
 * page (`/auth/email-link`, decision 0041) and the request link's
 * (`/auth/request-link`, decisions 0038 and 0040) sign in only with it.
 */
import { appUrl } from '@/lib/env';

/**
 * The headers in which a browser says where a request came from (Fetch
 * Metadata). Safari before 16.4 sends none of them, and no browser sends
 * them to an address that isn't secure (plain `http` on any host but
 * `localhost`).
 */
const FETCH_METADATA = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'] as const;

/** The site's own origin, as a browser names it in a `POST` from one of its pages (`Origin`). */
const SITE_ORIGIN = new URL(appUrl).origin;

/**
 * Checks whether a request is a form `POST` that a page of this site sent as
 * a page load: posted, which no link can do (a link, even one written in a
 * request's text on a page of this site, is a `GET`), with `Sec-Fetch-Site:
 * same-origin`, `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`,
 * which no other site, email or address typed in can make. It needn't say a
 * person clicked (`Sec-Fetch-User`, which Safari never sends).
 *
 * A browser that sends none of those headers (Safari before 16.4, and every
 * browser when Adiutor runs on plain `http` on a host other than
 * `localhost`) is checked by the `POST`'s `Origin` instead (decision 0040):
 * it must be exactly the site's own, which no other site's form can send, so
 * the pages that post send it (`referrer: strict-origin`). A missing
 * `Origin`, `null` or a `Referer` never counts, and as soon as any of the
 * headers is there, even empty, they decide alone.
 *
 * @param headers - The request's headers.
 * @param posted - Whether the browser posted it.
 * @returns Whether a page of this site posted it.
 */
export default function isOwnPagePost(headers: Headers, posted: boolean): boolean {
  if (!posted) {
    return false;
  }
  if (FETCH_METADATA.some((name) => headers.has(name))) {
    return (
      headers.get('sec-fetch-site') === 'same-origin' &&
      headers.get('sec-fetch-mode') === 'navigate' &&
      headers.get('sec-fetch-dest') === 'document'
    );
  }
  return headers.get('origin') === SITE_ORIGIN;
}
