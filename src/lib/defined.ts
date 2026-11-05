/**
 * @file Checked access to values that may be missing, instead of `!`: a
 * lookup the code expects to succeed (a map entry, an array element, the row
 * an insert returned) either gives the value or throws, naming what was
 * missing. TypeScript's `noUncheckedIndexedAccess` makes such lookups
 * possibly `undefined`, and `!` is refused by ESLint.
 */

/**
 * Returns a value that must be there, or throws when it's `undefined` or
 * `null`.
 *
 * @param value - The value.
 * @param what - What it is, for the error message (e.g. `'the first email'`).
 * @returns The value.
 * @throws {Error} `Expected <what>` when it's missing.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${what}`);
  }
  return value;
}

/**
 * Returns the first row of a query or insert result, or throws when there's
 * none (e.g. the row `insert(…).returning()` must have returned).
 *
 * @param rows - The result.
 * @param what - What the row is, for the error message (e.g. `'the new company'`).
 * @returns The first row.
 * @throws {Error} `Expected <what>` when the result is empty.
 */
export function firstRow<T>(rows: readonly T[], what: string): T {
  return defined(rows[0], what);
}
