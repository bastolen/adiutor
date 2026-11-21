/**
 * @file The link in an email about a request that signs its recipient in
 * (decision 0036). The email links straight to Better Auth's endpoint
 * ({@link REQUEST_LINK_URL_PATH}), which signs a person's click in and opens
 * the request; anything else (a mail scanner, a browser that doesn't say a
 * person clicked, someone else signed in in that browser, a link that no
 * longer works) goes to the confirmation page ({@link REQUEST_LINK_PAGE})
 * first. The link may be used again and again while it lasts.
 */

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
 * Builds the address a request link signs in at.
 *
 * @param token - The link's token.
 * @param options - Options.
 * @param options.confirmed - Whether it's the confirmation page's Continue
 *   ({@link REQUEST_LINK_CONFIRMED_PARAM}).
 * @returns The path and query, e.g. `/api/auth/request-link/sign-in?token=…`.
 */
export function requestLinkPath(token: string, { confirmed = false } = {}): string {
  const query = new URLSearchParams({ token });
  if (confirmed) {
    query.set(REQUEST_LINK_CONFIRMED_PARAM, '1');
  }
  return `${REQUEST_LINK_URL_PATH}?${query}`;
}

/**
 * Builds the confirmation page's address for a request link.
 *
 * @param token - The link's token.
 * @returns The path and query, e.g. `/auth/request-link?token=…`.
 */
export function requestLinkPagePath(token: string): string {
  return `${REQUEST_LINK_PAGE}?${new URLSearchParams({ token })}`;
}
