/**
 * @file Tests for keeping database values out of the logs: Drizzle's
 * parameters, Postgres's `detail` and the values Postgres quotes in its
 * message go, what failed stays, and anything else is logged as it is.
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

  it.each([
    [
      'a value that is no ID',
      `invalid input syntax for type uuid: "${EMAIL}"`,
      { code: '22P02', routine: 'string_to_uuid' },
      'invalid input syntax for type uuid: "[redacted]"',
    ],
    [
      'a value that is no member of an enum',
      `invalid input value for enum company_role: "${EMAIL}"`,
      { code: '22P02', routine: 'enum_in' },
      'invalid input value for enum company_role: "[redacted]"',
    ],
    [
      'a value with quotes of its own',
      `invalid input syntax for type uuid: "x" ${EMAIL} "y"`,
      { code: '22P02' },
      'invalid input syntax for type uuid: "[redacted]"',
    ],
    [
      'a value in the middle of the message',
      `value "${EMAIL}" is out of range for type integer`,
      { code: '22003' },
      'value "[redacted]" is out of range for type integer',
    ],
    [
      'a value after the names the error gives',
      `new row for relation "user" violates check constraint "user_name_check": "${EMAIL}"`,
      { code: '23514', table: 'user', constraint: 'user_name_check' },
      'new row for relation "user" violates check constraint "user_name_check": "[redacted]"',
    ],
    [
      'a quote that never closes',
      `invalid input syntax for type uuid: "${EMAIL}`,
      { code: '22P02' },
      'invalid input syntax for type uuid: "[redacted]"',
    ],
  ])(
    'replaces what Postgres quotes in its message (%s), keeping what failed',
    (_name, message, fields, expected) => {
      const postgres = Object.assign(new Error(message), {
        name: 'error',
        severity: 'ERROR',
        ...fields,
      });
      const failed = new DrizzleQueryError(
        'select "id" from "user" where "id" = $1',
        [EMAIL],
        postgres,
      );
      expect(printed(failed)).toContain(EMAIL);

      const redacted = redactLogValue(failed) as Error & { cause: Error };

      expect(printed(redacted)).not.toContain(EMAIL);
      expect(redacted.cause.message).toBe(expected);
      expect(redacted.cause.stack).toContain(expected);
      expect(redacted.cause).toMatchObject({ severity: 'ERROR', ...fields });
      // On its own (a query that didn't go through Drizzle), the same.
      expect((redactLogValue(postgres) as Error).message).toBe(expected);
    },
  );

  it('keeps the constraint, table, column, schema and data type Postgres names in its message', () => {
    const notNull = Object.assign(
      new Error('null value in column "name" of relation "user" violates not-null constraint'),
      {
        name: 'error',
        severity: 'ERROR',
        code: '23502',
        schema: 'public',
        table: 'user',
        column: 'name',
      },
    );
    const domain = Object.assign(
      new Error('value for domain "slug" violates check constraint "slug_check"'),
      {
        name: 'error',
        severity: 'ERROR',
        code: '23514',
        dataType: 'slug',
        constraint: 'slug_check',
      },
    );

    expect((redactLogValue(notNull) as Error).message).toBe(notNull.message);
    expect((redactLogValue(domain) as Error).message).toBe(domain.message);
    expect((redactLogValue(duplicateEmailError()) as Error).message).toBe(
      'duplicate key value violates unique constraint "user_email_unique"',
    );
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
