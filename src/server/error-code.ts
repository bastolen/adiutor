/**
 * @file Reads the code of a thrown error, for the database checks in
 * `errors.ts` (`isUniqueViolation`, `isDeadlock`) and the logs of the
 * migration check and the health check. Imports nothing, so the startup
 * check (`src/instrumentation.ts`) loads it without the rest of the server.
 */

/**
 * Finds the code of an error (a Node.js code such as `ECONNREFUSED`, or a
 * Postgres SQLSTATE such as `23505`), looking through its causes since Drizzle
 * wraps the driver's errors. Safe to log, unlike the message, which could hold
 * connection details or the query's values.
 *
 * @param error - The thrown value.
 * @param depth - How many causes deep this is.
 * @returns The code, or `null` when there's none.
 */
export default function errorCode(error: unknown, depth = 0): string | null {
  if (typeof error !== 'object' || error === null || depth > 3) {
    return null;
  }
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'cause' in error ? errorCode(error.cause, depth + 1) : null;
}
