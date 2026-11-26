/**
 * @file Conditional requests (RFC 9110): a browser that kept a response sends
 * back the entity tag it came with (`If-None-Match`), and when that's still
 * the response the server would send, the server answers `304 Not Modified`
 * without the body. Attached files use it (decision 0054): the browser keeps
 * a copy, and asks before each use.
 */

/**
 * A tag in an `If-None-Match` list: optionally weak (`W/`), then quoted,
 * without a quote inside.
 */
const LISTED_TAG = /(?:W\/)?"[^"]*"/g;

/**
 * The entity tag of a response, made from a version that names its bytes:
 * one that never changes while they don't.
 *
 * @param version - E.g. an attachment's ID; no quotes.
 * @returns The strong tag, quoted, e.g. `"0197a3b2-…"`.
 */
export function entityTag(version: string): string {
  return `"${version}"`;
}

/**
 * Whether a request's `If-None-Match` names the response's tag, so the
 * browser's copy is current. Compared weakly, as RFC 9110 asks for this
 * header: a `W/` prefix is ignored on either side, a list matches when any
 * of its tags does, and `*` matches any response there is. A value that
 * holds no quoted tag matches nothing.
 *
 * @param header - The request's `If-None-Match`, or `null` without one.
 * @param tag - The response's tag (`entityTag`).
 * @returns Whether the browser's copy is the response.
 */
export function matchesIfNoneMatch(header: string | null, tag: string): boolean {
  if (!header) {
    return false;
  }
  if (header.trim() === '*') {
    return true;
  }
  const opaque = tag.replace(/^W\//, '');
  return (header.match(LISTED_TAG) ?? []).some((listed) => listed.replace(/^W\//, '') === opaque);
}
