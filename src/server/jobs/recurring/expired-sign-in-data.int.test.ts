/**
 * @file Integration tests for the job that deletes expired sign-in data,
 * against the test database.
 */
import { describe, expect, it } from 'vitest';

import { rateLimitBucket, requestSignInLink, session, verification } from '@/db/schema';

import {
  createCompany,
  createSession,
  createUser,
  later,
  setupTestContext,
  storeAssignedRequest,
} from '../../../../tests/integration/helpers';
import { createRequestLink } from '../../auth/request-links';
import expiredSignInData from './expired-sign-in-data';

const { ctx, db } = setupTestContext();

describe('expired-sign-in-data', () => {
  it('removes expired values, ended request links, sessions and rate-limit windows only', async () => {
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
    // A link in an email about a request that ended, and one that still works.
    const requestId = await storeAssignedRequest(db, (await createCompany(db)).id, []);
    await createRequestLink(db, { userId: jane, requestId });
    await db.update(requestSignInLink).set({ expiresAt: past });
    await createRequestLink(db, { userId: jane, requestId });

    await expect(expiredSignInData.run(ctx, { deadline: later })).resolves.toEqual({
      summary: { verifications: 1, requestLinks: 1, sessions: 1, rateLimits: 1 },
    });
    expect(await db.select().from(requestSignInLink)).toHaveLength(1);
    expect((await db.select().from(session)).map(({ id }) => id)).toEqual([kept]);
    expect(await db.select().from(verification)).toHaveLength(1);
    expect(await db.select().from(rateLimitBucket)).toHaveLength(1);
  });
});
