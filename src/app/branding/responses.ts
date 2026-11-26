/**
 * @file The responses of the brand's image routes (decision 0052): a PNG or
 * `.ico` Adiutor drew itself, for anyone, that nothing sniffs as another
 * kind of file. An address with the current version may be kept for a year
 * (a new upload gets a new address); any other is kept for five minutes, so
 * an old link still shows what's current. The proxy gives these routes a
 * fixed policy in which nothing loads or runs (`FILE_POLICY`).
 */

/** How long an address with the current version may be kept: a year, unchanged. */
const KEEP_VERSIONED = 'public, max-age=31536000, immutable';

/** How long any other address may be kept. */
const KEEP_BRIEFLY = 'public, max-age=300';

/**
 * An image response.
 *
 * @param body - The image's bytes.
 * @param contentType - Its media type.
 * @param current - Whether the address carries the image's current version.
 * @returns The response.
 */
export function imageResponse(body: Uint8Array, contentType: string, current: boolean): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': current ? KEEP_VERSIONED : KEEP_BRIEFLY,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * The answer when there's no image to show: nothing was uploaded.
 *
 * @returns A `404`, kept by nobody.
 */
export function noImage(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Sends the browser to a file of Adiutor's own, kept for five minutes.
 *
 * @param path - The file's path, e.g. `/brand/favicon.ico`.
 * @returns A temporary redirect.
 */
export function adiutorFile(path: string): Response {
  return new Response(null, {
    status: 307,
    headers: { Location: path, 'Cache-Control': KEEP_BRIEFLY },
  });
}
