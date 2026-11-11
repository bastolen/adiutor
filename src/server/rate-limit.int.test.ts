/**
 * @file Integration tests for the app's rate limiter (`rate-limit.ts`):
 * counting hits in a window, giving one back and starting a new window, against the test database.
 */
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { rateLimitBucket } from '@/db/schema';

import { setupTestContext } from '../../tests/integration/helpers';
import { assertRateLimit, hitRateLimit, releaseRateLimitHit } from './rate-limit';

const { ctx, db } = setupTestContext();

describe('rate limits', () => {
  const rule = { limit: 2, windowSeconds: 60 };

  it('allows hits up to the limit, then refuses with a wait time', async () => {
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ allowed: true });
    await expect(hitRateLimit(ctx, 'test:key', rule)).resolves.toMatchObject({ allowed: true });
    await expect(assertRateLimit(ctx, 'test:key', rule)).rejects.toMatchObject({
      code: 'rate_limited',
      key: 'errors.tooManyAttempts',
      values: { minutes: 1 },
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
