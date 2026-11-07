/**
 * @file Integration tests for the app's rate limiter (`rate-limit.ts`):
 * counting hits in a window, giving one back, lifting a sign-in pause for one
 * address and starting a new window, against the test database.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { rateLimitBucket } from '@/db/schema';

import {
  assertRateLimit,
  clearFailedSignIns,
  hitRateLimit,
  releaseRateLimitHit,
} from './rate-limit';
import { setupTestContext } from '../../tests/integration/helpers';

const { ctx, db } = setupTestContext();

describe('rate limits', () => {
  const rule = { limit: 2, windowSeconds: 60 };

  it('allows hits up to the limit, then refuses with a wait time', async () => {
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ allowed: true });
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ allowed: true });
    await expect(assertRateLimit(ctx, 'test:key', rule)).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Too many attempts. Try again in 1 minute.',
    });
    // Other keys are counted separately.
    await expect(hitRateLimit(ctx, 'test:other', rule)).resolves.toMatchObject({ allowed: true });
  });

  it('counts the hits in the window, and gives one back, never below zero', async () => {
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ hits: 1 });
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ hits: 2 });
    await hitRateLimit(ctx, 'test:other', rule);

    await releaseRateLimitHit(ctx, 'test:key');
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ hits: 2 });
    await Promise.all([1, 2, 3].map(() => releaseRateLimitHit(ctx, 'test:key')));
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ hits: 1 });
    await expect(hitRateLimit(ctx, 'test:other', rule)).resolves.toMatchObject({ hits: 2 });
  });

  it('lifts a pause on password sign-in for one address only', async () => {
    const failed = { limit: 10, windowSeconds: 15 * 60 };
    await hitRateLimit(ctx, 'sign-in-failed:email:jane@adiutor.test', failed);
    await hitRateLimit(ctx, 'sign-in-failed:email:john@adiutor.test', failed);

    await clearFailedSignIns(db, ' Jane@Adiutor.test');

    const left = await db.select({ key: rateLimitBucket.key }).from(rateLimitBucket);
    expect(left.map(({ key }) => key)).toEqual(['sign-in-failed:email:john@adiutor.test']);
  });

  it('starts a new window once the old one has passed', async () => {
    await hitRateLimit(ctx, 'test:key', rule);
    await hitRateLimit(ctx, 'test:key', rule);
    await db
      .update(rateLimitBucket)
      .set({ resetAt: sql`now() - interval '1 second'` })
      .where(eq(rateLimitBucket.key, 'test:key'));

    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ allowed: true });
  });
});
