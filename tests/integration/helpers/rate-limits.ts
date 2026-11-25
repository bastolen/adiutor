/**
 * @file Filling and reading rate limit buckets.
 */
import { eq, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { rateLimitBucket } from '@/db/schema';

/**
 * Uses up a rate limit the way earlier hits would have: its bucket is full
 * for the next hour.
 *
 * @param db - Test database.
 * @param key - The bucket, e.g. `invite:user:<id>`.
 * @param limit - The limit (`RATE_LIMITS.*.limit`).
 */
export async function fillRateLimitBucket(db: Database, key: string, limit: number): Promise<void> {
  await db
    .insert(rateLimitBucket)
    .values({ key, count: limit, resetAt: sql`now() + interval '1 hour'` });
}

/**
 * Reads how many hits a rate limit bucket has counted.
 *
 * @param db - Test database.
 * @param key - The bucket.
 * @returns The count, or `null` when nothing was counted.
 */
export async function rateLimitHits(db: Database, key: string): Promise<number | null> {
  const [row] = await db
    .select({ count: rateLimitBucket.count })
    .from(rateLimitBucket)
    .where(eq(rateLimitBucket.key, key));
  return row?.count ?? null;
}
