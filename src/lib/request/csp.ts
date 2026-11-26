/**
 * @file The Content Security Policy, built per request by the proxy
 * (`src/proxy.ts`) with a fresh nonce. Only scripts carrying that nonce run
 * (`'strict-dynamic'` also trusts what they load): Next.js adds it to its own
 * scripts by reading this header from the request, and the root layout adds it
 * to the theme script. So an injected `<script>` or event-handler attribute
 * doesn't run. This needs every page rendered per request (the root layout reads
 * the nonce), so there's no prerendered static shell.
 *
 * Styles still allow `'unsafe-inline'`: React and Radix position elements with
 * `style` attributes, which a nonce can't cover.
 */

/**
 * The policy of a file served from `/attachments/` (an attached file, always
 * a download) or `/branding/` (an image Adiutor drew): nothing in it may load
 * or run, and it's sandboxed, should a browser ever show one as a page.
 * Fixed: a file has no scripts to give a nonce to.
 */
export const FILE_POLICY = "default-src 'none'; sandbox";

/** Where attached files are served from: one of the {@link FILE_PATHS}. */
export const ATTACHMENTS_PATH = '/attachments/';

/**
 * The paths that serve files, which get {@link FILE_POLICY}: attached files,
 * and the brand's images (the uploaded logo and the icon made from the
 * brand, decision 0052).
 */
export const FILE_PATHS: readonly string[] = [ATTACHMENTS_PATH, '/branding/'];

/**
 * Whether a path serves a file, and so gets {@link FILE_POLICY}.
 *
 * @param pathname - The request's path.
 * @returns Whether it's below one of the {@link FILE_PATHS}.
 */
export function servesFile(pathname: string): boolean {
  return FILE_PATHS.some((prefix) => pathname.startsWith(prefix));
}

/** Request header the proxy passes the nonce in, for the root layout. */
export const NONCE_HEADER = 'x-nonce';

/**
 * Makes a fresh, unguessable nonce for one request.
 *
 * @returns 128 random bits, base64-encoded.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Builds the policy for one request.
 *
 * @param nonce - The request's nonce (see {@link createNonce}).
 * @param isDevelopment - Whether this is the development server, where React
 *   needs `eval` for its error overlay.
 * @returns The `Content-Security-Policy` header value.
 */
export function contentSecurityPolicy(
  nonce: string,
  // eslint-disable-next-line no-restricted-properties -- The proxy builds this on every request without the app's configuration; Next.js replaces NODE_ENV at build time.
  isDevelopment = process.env.NODE_ENV === 'development',
): string {
  return [
    "default-src 'self'",
    // Keep `script-src` before `script-src-attr`: Next.js takes the nonce from the first directive
    // that starts with "script-src".
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // Inline event handlers (`onclick="…"`, `onerror="…"`) never run; React doesn't use them.
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
