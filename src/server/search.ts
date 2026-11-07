/**
 * @file Helpers for text search in SQL queries.
 */

/**
 * Turns a search term into an `ILIKE` pattern that matches it anywhere. `%`,
 * `_` and `\` in the term are escaped, so they match literally.
 *
 * @param term - The search term.
 * @returns The pattern, e.g. `%adiutor%`.
 */
export default function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}
