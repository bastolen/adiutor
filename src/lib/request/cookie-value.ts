/**
 * @file Reads one cookie's value from a list of cookies. Pure and free of
 * imports, so the browser, the server and the Better Auth CLI can all use it.
 */

/**
 * Reads a cookie's value from a list of cookies: a request's `Cookie` header,
 * or `document.cookie` in the browser.
 *
 * @param cookies - The cookies, as `name=value` pairs split by `;`.
 * @param name - The cookie's name.
 * @returns The decoded value (everything after the first `=`), or `null` when
 * the cookie isn't there or its value isn't valid URL encoding.
 */
export function cookieValue(cookies: string | null | undefined, name: string): string | null {
  const prefix = `${name}=`;
  const pair = cookies
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!pair) {
    return null;
  }
  try {
    return decodeURIComponent(pair.slice(prefix.length));
  } catch {
    // A malformed escape: treated like a missing cookie.
    return null;
  }
}
