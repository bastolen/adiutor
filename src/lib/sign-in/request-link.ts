/**
 * @file The link in an email about a request that signs its recipient in
 * (decision 0036). The email links straight to Better Auth's endpoint
 * ({@link REQUEST_LINK_URL_PATH}), which signs a person's click in and opens
 * the request; anything else (a mail scanner, a browser that doesn't say a
 * person clicked, someone else signed in in that browser, a link that no
 * longer works) goes to the confirmation page ({@link REQUEST_LINK_PAGE})
 * first. The link may be used again and again while it lasts. It may name
 * the entry the email points at (`entry`), which it passes on to the
 * request's page (`?entry=<ID>`), so the reader's activity filter never
 * hides it.
 */
import { ENTRY_PARAM, isEntryId } from '@/lib/requests';

/**
 * How long a request link works, in days: what the email says, and when the
 * job that sends it lets it expire (`createRequestLink`).
 */
export const REQUEST_LINK_DAYS = 14;

/** Better Auth's endpoint that signs in with a request link, as its plugin registers it. */
export const REQUEST_LINK_ENDPOINT = '/request-link/sign-in';

/** The address of {@link REQUEST_LINK_ENDPOINT}, under the app's `/api/auth` handler. */
export const REQUEST_LINK_URL_PATH = `/api/auth${REQUEST_LINK_ENDPOINT}`;

/** The confirmation page a request link goes to when it doesn't sign in straight away. */
export const REQUEST_LINK_PAGE = '/auth/request-link';

/**
 * The query parameter the confirmation page's Continue adds: the click was
 * made there, so it may switch from someone else who is signed in. It only
 * counts with a same-origin click (`Sec-Fetch-Site: same-origin`), which
 * another site can't make.
 */
export const REQUEST_LINK_CONFIRMED_PARAM = 'confirmed';

/**
 * The query of a request link's addresses: its token, and the entry it
 * points at when that's an entry's ID (anything else is left out).
 *
 * @param token - The link's token.
 * @param entry - The entry's ID, if any.
 * @returns The query.
 */
function linkQuery(token: string, entry: string | null | undefined): URLSearchParams {
  const query = new URLSearchParams({ token });
  if (isEntryId(entry)) {
    query.set(ENTRY_PARAM, entry);
  }
  return query;
}

/**
 * Builds the address a request link signs in at.
 *
 * @param token - The link's token.
 * @param options - Options.
 * @param options.confirmed - Whether it's the confirmation page's Continue
 *   ({@link REQUEST_LINK_CONFIRMED_PARAM}).
 * @param options.entry - The ID of the entry the link points at, passed on to the request.
 * @returns The path and query, e.g. `/api/auth/request-link/sign-in?token=…&entry=…`.
 */
export function requestLinkPath(
  token: string,
  { confirmed = false, entry = null }: { confirmed?: boolean; entry?: string | null } = {},
): string {
  const query = linkQuery(token, entry);
  if (confirmed) {
    query.set(REQUEST_LINK_CONFIRMED_PARAM, '1');
  }
  return `${REQUEST_LINK_URL_PATH}?${query}`;
}

/**
 * Builds the confirmation page's address for a request link.
 *
 * @param token - The link's token.
 * @param options - Options.
 * @param options.entry - The ID of the entry the link points at, passed on to the request.
 * @returns The path and query, e.g. `/auth/request-link?token=…&entry=…`.
 */
export function requestLinkPagePath(
  token: string,
  { entry = null }: { entry?: string | null } = {},
): string {
  return `${REQUEST_LINK_PAGE}?${linkQuery(token, entry)}`;
}
