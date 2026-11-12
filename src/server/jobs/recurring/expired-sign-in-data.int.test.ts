/**
 * @file Integration tests for the job that deletes expired sign-in data,
 * against the test database.
 */
import { describe, expect, it } from 'vitest';

import { rateLimitBucket, session, verification } from '@/db/schema';

import { createSession, createUser, setupTestContext } from '../../../../tests/integration/helpers';
import expiredSignInData from './expired-sign-in-data';

const { ctx, db } = setupTestContext();

/** Far enough away that no test reaches it. */
const deadline = new Date(Date.now() + 60 * 60_000);

describe('expired-sign-in-data', () => {
  it('removes expired values, sessions and rate-limit windows only', async () => {
    const jane = await createUser(db, 'jane@adiutor.test');
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    await db.insert(verification).values([
      { identifier: 'old', value: 'x', expiresAt: past },
      { identifier: 'new', value: 'x', expiresAt: future },
    ]);
    await createSession(db, jane, { expiresAt: past });
    const kept = await createSession(db, jane);
    await db.insert(rateLimitBucket).values([
      { key: 'old', count: 1, resetAt: past },
      { key: 'new', count: 1, resetAt: future },
    ]);

    await expect(expiredSignInData.run(ctx, { deadline })).resolves.toEqual({
      summary: { verifications: 1, sessions: 1, rateLimits: 1 },
    });
    expect((await db.select().from(session)).map(({ id }) => id)).toEqual([kept]);
    expect(await db.select().from(verification)).toHaveLength(1);
    expect(await db.select().from(rateLimitBucket)).toHaveLength(1);
  });
});
