/**
 * @file Integration test for keeping database values out of the logs, with
 * real errors from Drizzle and Postgres against the test database, so a
 * driver update that changes their shape is caught.
 */
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { account, user } from '@/db/schema';

import { createUser, setupTestContext } from '../../tests/integration/helpers';
import { REDACTED, redactLogValue } from './log-redaction';

const { db } = setupTestContext();

/**
 * Runs a query that must fail and returns its error.
 *
 * @param query - The query.
 * @returns The error it threw.
 */
async function failureOf(query: () => Promise<unknown>): Promise<unknown> {
  try {
    await query();
  } catch (error) {
    return error;
  }
  throw new Error('The query was expected to fail.');
}

describe('a failed query, as logged', () => {
  it('keeps the query, SQL state and constraint, but none of the values', async () => {
    await createUser(db, 'jane@adiutor.test');

    const duplicate = await failureOf(() =>
      db.insert(user).values({ name: 'Jane Adiutor Tests', email: 'jane@adiutor.test' }),
    );
    // The raw error holds the values, in Drizzle's message and Postgres's detail.
    expect(inspect(duplicate, { depth: 10 })).toContain('jane@adiutor.test');

    const logged = inspect(redactLogValue(duplicate), { depth: 10 });

    expect(logged).not.toContain('jane@adiutor.test');
    expect(logged).not.toContain('Jane Adiutor Tests');
    expect(logged).toContain('insert into "user"');
    expect(logged).toContain(`params: ${REDACTED}`);
    expect(logged).toContain("code: '23505'");
    expect(logged).toContain('user_email_unique');
  });

  it('drops a password hash and token from a row that could not be stored', async () => {
    const failed = await failureOf(() =>
      db.insert(account).values({
        userId: '00000000-0000-7000-8000-000000000000',
        accountId: 'adiutor-tests',
        providerId: 'credential',
        password: 'adiutor-tests-hash:5f3a',
        accessToken: 'gho_adiutor-tests-token',
      }),
    );

    const logged = inspect(redactLogValue(failed), { depth: 10 });

    expect(logged).not.toContain('adiutor-tests-hash');
    expect(logged).not.toContain('gho_adiutor-tests-token');
    expect(logged).not.toContain('00000000-0000-7000-8000-000000000000');
    expect(logged).toContain("code: '23503'");
  });
});
