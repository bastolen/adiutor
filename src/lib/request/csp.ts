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
 * a download): nothing in it may load or run, and it's sandboxed, should a
 * browser ever show one instead of saving it. Fixed: a file has no scripts
 * to give a nonce to.
 */
export const FILE_POLICY = "default-src 'none'; sandbox";

/**
 * The policy of an image a browser may show on its own, opened in a tab:
 * Adiutor's own logos and icons (`next.config.ts`) and the brand's images
 * from `/branding/` (decision 0052). Nothing in it may run (an SVG's
 * scripts included) or load from elsewhere; only the image itself and the
 * styles of the browser's own image viewer.
 */
export const IMAGE_FILE_POLICY =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

/** Where attached files are served from. */
export const ATTACHMENTS_PATH = '/attachments/';

/** Where the brand's images are served from (the uploaded logo and the icon made from the brand). */
export const BRANDING_FILES_PATH = '/branding/';

/**
 * The fixed policy of a path that serves a file rather than a page:
 * {@link FILE_POLICY} for attached files, {@link IMAGE_FILE_POLICY} for the
 * brand's images. The proxy sets it, as Next.js puts the proxy's headers
 * over a route's own.
 *
 * @param pathname - The request's path.
 * @returns The policy, or `null` for a page, which gets one with a nonce.
 */
export function filePolicyFor(pathname: string): string | null {
  if (pathname.startsWith(ATTACHMENTS_PATH)) {
    return FILE_POLICY;
  }
  return pathname.startsWith(BRANDING_FILES_PATH) ? IMAGE_FILE_POLICY : null;
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
