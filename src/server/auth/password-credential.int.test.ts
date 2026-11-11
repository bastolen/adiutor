/**
 * @file Integration tests for giving a just-created account its password:
 * Better Auth's credential row, and lifting the wrong-password pause for that
 * address only.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { account, rateLimitBucket } from '@/db/schema';

import { createUser, setupTestContext } from '../../../tests/integration/helpers';
import { hitRateLimit } from '../rate-limit';
import { failedSignInsKey } from './failed-sign-ins';
import addPasswordCredential from './password-credential';

const { db } = setupTestContext();

describe('addPasswordCredential', () => {
  it('adds the credential Better Auth signs in with', async () => {
    const userId = await createUser(db, 'new@adiutor.test');

    await db.transaction((tx) =>
      addPasswordCredential(tx, {
        userId,
        email: 'new@adiutor.test',
        passwordHash: 'adiutor-tests-hash',
      }),
    );

    expect(
      await db
        .select({
          accountId: account.accountId,
          providerId: account.providerId,
          password: account.password,
        })
        .from(account)
        .where(eq(account.userId, userId)),
    ).toEqual([{ accountId: userId, providerId: 'credential', password: 'adiutor-tests-hash' }]);
  });

  it('lifts the pause on password sign-in for that address only', async () => {
    const userId = await createUser(db, 'new@adiutor.test');
    const failed = { limit: 10, windowSeconds: 15 * 60 };
    await hitRateLimit({ db }, failedSignInsKey('new@adiutor.test'), failed);
    await hitRateLimit({ db }, failedSignInsKey('other@adiutor.test'), failed);

    await db.transaction((tx) =>
      addPasswordCredential(tx, {
        userId,
        email: 'new@adiutor.test',
        passwordHash: 'adiutor-tests-hash',
      }),
    );

    const left = await db
      .select({ key: rateLimitBucket.key })
      .from(rateLimitBucket)
      .where(sql`${rateLimitBucket.key} like 'sign-in-failed:%'`);
    expect(left).toEqual([{ key: failedSignInsKey('other@adiutor.test') }]);
  });
});
