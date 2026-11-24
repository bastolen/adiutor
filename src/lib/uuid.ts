/**
 * @file The shape of a database ID in text the app reads back: an anchor or
 * address that names a request's entry, the marker of a stored mention.
 * Free of dependencies, so anything can build its patterns with it.
 */

/**
 * A database ID as Postgres writes it (a UUID, in lowercase), as the source
 * of a regular expression, without anchors or a group: e.g.
 * `new RegExp(`^${UUID_SOURCE}$`)`.
 */
export const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
