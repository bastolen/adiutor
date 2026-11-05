/**
 * @file Keeps database values out of the server's logs. A failed query's
 * error carries every value it was sent: Drizzle's message ends with
 * `params: …` and Postgres's error adds a `detail` such as
 * `Key (email)=(…) already exists.` Those can be email addresses, names, IP
 * addresses, browsers, password hashes and session tokens.
 *
 * {@link installLogRedaction} makes every `console` call drop them, so Next's
 * own error logging, Better Auth's logger and the app's code are covered
 * alike. It's installed by `src/instrumentation.ts` for the server and at
 * the start of each script in `scripts/`. Everything else in a log line stays
 * as it is: the query itself, the SQL state and the constraint, and Next's
 * `digest`, so a failure can still be traced.
 */

/** What replaces a removed value. */
export const REDACTED = '[redacted]';

/**
 * Drizzle's parameter list in a message or stack: everything after
 * `\nparams: ` up to the stack trace (`\n    at …`) or the end.
 */
const DRIZZLE_PARAMS = /\nparams: [\s\S]*?(?=\n {4}at |$)/g;

/** The fields of a Postgres error that say what failed without the values involved. */
const POSTGRES_FIELDS = [
  'severity',
  'code',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
  'routine',
] as const;

/** How deep {@link redactLogValue} looks into causes, fields, plain objects and arrays. */
const MAX_DEPTH = 4;

/**
 * Removes Drizzle's parameter list from a string.
 *
 * @param text - A log message or stack.
 * @returns The text with the values replaced.
 */
function redactText(text: string): string {
  return text.includes('\nparams: ') ? text.replace(DRIZZLE_PARAMS, `\nparams: ${REDACTED}`) : text;
}

/**
 * Whether a value is Drizzle's error for a failed query (`DrizzleQueryError`),
 * recognised by its shape so a second copy of drizzle-orm is covered too.
 *
 * @param value - The value.
 * @returns Whether it is.
 */
function isDrizzleQueryError(value: Error): value is Error & { query: string; params: unknown } {
  return 'query' in value && 'params' in value && value.message.startsWith('Failed query: ');
}

/**
 * Whether a value is an error from Postgres (the `pg` driver's
 * `DatabaseError`): it has a severity and a SQL state.
 *
 * @param value - The value.
 * @returns Whether it is.
 */
function isPostgresError(value: Error): boolean {
  const fields = value as unknown as Record<string, unknown>;
  return typeof fields.severity === 'string' && typeof fields.code === 'string';
}

/**
 * Whether a value holds database values somewhere: a Drizzle or Postgres
 * error, Drizzle's parameter list in a string, or either of those in an
 * error's cause or fields, or in a plain object or array.
 *
 * @param value - The value.
 * @param depth - How deep this is in the log value.
 * @returns Whether {@link redactLogValue} would change it.
 */
function holdsDatabaseValues(value: unknown, depth: number): boolean {
  if (typeof value === 'string') {
    return value.includes('\nparams: ');
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return false;
  }
  if (value instanceof Error) {
    if (isDrizzleQueryError(value) || isPostgresError(value)) {
      return true;
    }
    if (holdsDatabaseValues(value.message, depth) || holdsDatabaseValues(value.stack, depth)) {
      return true;
    }
    const fields = value as unknown as Record<string, unknown>;
    return [value.cause, ...Object.keys(value).map((field) => fields[field])].some((item) =>
      holdsDatabaseValues(item, depth + 1),
    );
  }
  if (Array.isArray(value)) {
    return value.some((item) => holdsDatabaseValues(item, depth + 1));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  return Object.values(value).some((item) => holdsDatabaseValues(item, depth + 1));
}

/**
 * Copies an error with its values removed, keeping its class name, message,
 * stack and the fields that say what failed, and Next's `digest` (the
 * reference its error page shows), so the log line can be found from it.
 *
 * @param error - The error.
 * @param depth - How deep this is in the log value.
 * @returns The copy.
 */
function redactError(error: Error, depth: number): Error {
  // A failed query's message is rebuilt from its SQL rather than cut, so no value can end the cut.
  const message = isDrizzleQueryError(error)
    ? `Failed query: ${error.query}\nparams: ${REDACTED}`
    : redactText(error.message);
  const copy = new Error(message);
  copy.name = error.name;
  copy.stack =
    error.stack === undefined
      ? undefined
      : redactText(
          error.stack.includes(error.message)
            ? error.stack.replace(error.message, message)
            : error.stack,
        );
  const fields = error as unknown as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  if (typeof fields.digest === 'string') {
    kept.digest = fields.digest;
  }
  if (isDrizzleQueryError(error)) {
    kept.query = error.query;
    kept.params = REDACTED;
  } else if (isPostgresError(error)) {
    POSTGRES_FIELDS.forEach((field) => {
      if (fields[field] !== undefined) {
        kept[field] = fields[field];
      }
    });
  } else {
    // Other errors keep their own fields (e.g. a status code), with values checked the same way.
    Object.keys(error).forEach((field) => {
      if (field !== 'cause') {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define -- They call each other: an error's fields are values too.
        kept[field] = redactLogValue(fields[field], depth + 1);
      }
    });
  }

  if (error.cause !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- They call each other: a cause is a value too.
    kept.cause = redactLogValue(error.cause, depth + 1);
  }
  return Object.assign(copy, kept);
}

/**
 * Removes database values from something about to be logged: Drizzle's
 * parameters and Postgres's `detail`, in errors (and their causes), strings,
 * and plain objects and arrays holding them. Anything without them is
 * returned as it is (the same object), so other errors keep their class.
 *
 * @param value - One argument of a `console` call.
 * @param depth - How deep this is (for nested values); leave it out.
 * @returns The value to log.
 */
export function redactLogValue(value: unknown, depth = 0): unknown {
  if (!holdsDatabaseValues(value, depth)) {
    return value;
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Error) {
    return redactError(value, depth);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactLogValue(item, depth + 1)]),
  );
}

/** The `console` methods that write logs. */
const CONSOLE_METHODS = ['error', 'warn', 'info', 'log', 'debug', 'trace'] as const;

/** Marks a `console` that already redacts, so installing twice doesn't wrap twice. */
const INSTALLED = Symbol.for('adiutor.logRedaction');

/**
 * Makes every `console` call of this process remove database values from
 * what it logs (see {@link redactLogValue}). Safe to call more than once.
 *
 * @param target - The console to wrap; the global one by default.
 */
export function installLogRedaction(target: Console = console): void {
  const marked = target as Console & { [INSTALLED]?: true };
  if (marked[INSTALLED]) {
    return;
  }
  CONSOLE_METHODS.forEach((method) => {
    const original = target[method].bind(target);
    /**
     * Logs like the original method, without database values.
     *
     * @param args - What to log.
     */
    const redacted = (...args: unknown[]): void => {
      original(...args.map((arg) => redactLogValue(arg)));
    };
    Object.assign(target, { [method]: redacted });
  });
  marked[INSTALLED] = true;
}
