/**
 * @file Tests for keeping database values out of the logs: Drizzle's
 * parameters and Postgres's `detail` go, what failed stays, and anything
 * else is logged as it is.
 */
import { inspect } from 'node:util';

import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { installLogRedaction, REDACTED, redactLogValue } from './log-redaction';

/** Values a failing query could carry. */
const EMAIL = 'jane@adiutor.test';
const PASSWORD_HASH = 'adiutor-tests-hash:5f3a';

/**
 * Builds the error Postgres returns for a duplicate address, as the `pg`
 * driver does.
 *
 * @returns The error.
 */
function duplicateEmailError(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "user_email_unique"'),
    {
      name: 'error',
      severity: 'ERROR',
      code: '23505',
      detail: `Key (email)=(${EMAIL}) already exists.`,
      schema: 'public',
      table: 'user',
      constraint: 'user_email_unique',
      where: `SQL statement with ${EMAIL}`,
    },
  );
}

/**
 * Builds Drizzle's error for that failed insert.
 *
 * @returns The error.
 */
function failedInsert(): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "user" ("name", "email", "password") values ($1, $2, $3)',
    ['Jane', EMAIL, PASSWORD_HASH],
    duplicateEmailError(),
  );
}

/**
 * Renders a value as Node prints it in a log line, with everything nested.
 *
 * @param value - The value.
 * @returns The text.
 */
const printed = (value: unknown) => inspect(value, { depth: 10 });

describe('redactLogValue', () => {
  it("drops a failed query's values, keeping the query and what failed", () => {
    const original = failedInsert();
    expect(printed(original)).toContain(EMAIL);

    const redacted = redactLogValue(original) as Error & Record<string, unknown>;

    expect(printed(redacted)).not.toContain(EMAIL);
    expect(printed(redacted)).not.toContain(PASSWORD_HASH);
    expect(printed(redacted)).not.toContain('Jane');
    expect(redacted.message).toBe(
      `Failed query: insert into "user" ("name", "email", "password") values ($1, $2, $3)\nparams: ${REDACTED}`,
    );
    expect(redacted.stack).toContain(`params: ${REDACTED}`);
    expect(redacted.stack).toMatch(/\n {4}at /);
    expect(redacted).toMatchObject({ query: original.query, params: REDACTED });
    expect(redacted.cause).toMatchObject({
      message: 'duplicate key value violates unique constraint "user_email_unique"',
      code: '23505',
      table: 'user',
      constraint: 'user_email_unique',
    });
    expect(redacted.cause).not.toHaveProperty('detail');
    expect(redacted.cause).not.toHaveProperty('where');
  });

  it("keeps Next's digest, so the error page's reference finds the log line", () => {
    const query = Object.assign(failedInsert(), { digest: '2338785109' });
    const postgres = Object.assign(duplicateEmailError(), { digest: '42' });

    expect(redactLogValue(query)).toMatchObject({ digest: '2338785109' });
    expect(redactLogValue(postgres)).toMatchObject({ digest: '42' });
    expect(printed(redactLogValue(query))).toContain("digest: '2338785109'");
  });

  it('drops every value, even one that looks like the start of a stack trace', () => {
    const trap = new DrizzleQueryError('select $1, $2', ['\n    at x', EMAIL]);

    const redacted = redactLogValue(trap) as Error;

    expect(printed(redacted)).not.toContain(EMAIL);
    expect(redacted.message).toBe(`Failed query: select $1, $2\nparams: ${REDACTED}`);
    expect(redacted.stack).toMatch(/\n {4}at /);
  });

  it('finds them in the cause or fields of another error, and keeps its other fields', () => {
    const wrapped = Object.assign(new Error('Auth reaction "after /sign-in/email" failed'), {
      status: 500,
    });
    wrapped.cause = failedInsert();

    const redacted = redactLogValue(wrapped) as Error & { status: number };

    expect(printed(redacted)).not.toContain(EMAIL);
    expect(redacted.message).toBe(wrapped.message);
    expect(redacted.status).toBe(500);
    expect(printed(redactLogValue({ error: failedInsert() }))).not.toContain(EMAIL);
    expect(printed(redactLogValue([duplicateEmailError()]))).not.toContain(EMAIL);
  });

  it('drops the values from a printed error, keeping its stack', () => {
    const stack = `Error: Failed query: select 1\nparams: ${EMAIL},${PASSWORD_HASH}\n    at query (db.ts:1:1)`;

    expect(redactLogValue(stack)).toBe(
      `Error: Failed query: select 1\nparams: ${REDACTED}\n    at query (db.ts:1:1)`,
    );
  });

  it('leaves everything else as it is, the same object', () => {
    const other = Object.assign(new TypeError('fetch failed'), { digest: '123' });
    const details = { email: EMAIL };

    expect(redactLogValue(other)).toBe(other);
    expect(redactLogValue(details)).toBe(details);
    expect(redactLogValue(`Sending the email to ${EMAIL} failed`)).toBe(
      `Sending the email to ${EMAIL} failed`,
    );
    expect(redactLogValue(42)).toBe(42);
  });
});

describe('installLogRedaction', () => {
  /** The console methods that must redact. */
  const methods = ['error', 'warn', 'info', 'log', 'debug', 'trace'] as const;

  it.each(methods)('makes console.%s redact, and leaves other arguments as they are', (method) => {
    const target = Object.fromEntries(methods.map((name) => [name, vi.fn()]));
    const original = defined(target[method], 'the console method');

    installLogRedaction(target as unknown as Console);
    defined(target[method], 'the wrapped console method')(
      'Auth reaction failed',
      failedInsert(),
      'Signed in',
    );

    expect(original).toHaveBeenCalledTimes(1);
    const call = defined(original.mock.calls[0], 'the first call');
    expect(printed(call)).not.toContain(EMAIL);
    expect(call[0]).toBe('Auth reaction failed');
    expect(call[2]).toBe('Signed in');
  });

  it('wraps only once, however often it is installed', () => {
    const target = Object.fromEntries(methods.map((name) => [name, vi.fn()]));

    installLogRedaction(target as unknown as Console);
    const wrapped = target.error;
    installLogRedaction(target as unknown as Console);

    expect(target.error).toBe(wrapped);
  });
});
