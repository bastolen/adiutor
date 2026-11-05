/**
 * @file Looks up a value in a fixed table (messages by error code, by query
 * parameter) by a key that comes from outside, so only the table's own
 * entries count, never one inherited from `Object.prototype` (such as
 * `constructor`).
 */

/**
 * Returns a record's own value for a key, or `undefined` when it has none.
 *
 * @param record - The table.
 * @param key - The key, e.g. an error code from a URL.
 * @returns The value, or `undefined`.
 */
export default function ownValue<V>(
  record: Readonly<Record<string, V>>,
  key: string,
): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
