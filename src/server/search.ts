/**
 * @file Helpers for text search in SQL queries.
 */
import { withoutControlCharacters } from '@/lib/character-rules';

/**
 * Turns a search term into an `ILIKE` pattern that matches it anywhere. `%`,
 * `_` and `\` in the term are escaped, so they match literally. Control
 * characters are dropped: nothing people search for has them, and Postgres
 * refuses a query with a NUL character (`?q=%00`), which would be an error
 * page instead of a list.
 *
 * @param term - The search term.
 * @returns The pattern, e.g. `%adiutor%`.
 */
export default function containsPattern(term: string): string {
  return `%${withoutControlCharacters(term).replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}
