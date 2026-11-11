/**
 * @file Integration test for lifting the pause on password sign-in for one
 * address (`failed-sign-ins.ts`), against the test database.
 */
import { describe, expect, it } from 'vitest';

import { rateLimitBucket } from '@/db/schema';

import { setupTestContext } from '../../../tests/integration/helpers';
import { hitRateLimit } from '../rate-limit';
import { clearFailedSignIns } from './failed-sign-ins';

const { ctx, db } = setupTestContext();

describe('clearFailedSignIns', () => {
  it('lifts a pause on password sign-in for one address only', async () => {
    const failed = { limit: 10, windowSeconds: 15 * 60 };
    await hitRateLimit(ctx, 'sign-in-failed:email:jane@adiutor.test', failed);
    await hitRateLimit(ctx, 'sign-in-failed:email:john@adiutor.test', failed);

    await clearFailedSignIns(db, ' Jane@Adiutor.test');

    const left = await db.select({ key: rateLimitBucket.key }).from(rateLimitBucket);
    expect(left.map(({ key }) => key)).toEqual(['sign-in-failed:email:john@adiutor.test']);
  });
});
