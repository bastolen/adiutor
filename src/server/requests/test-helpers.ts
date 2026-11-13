/**
 * @file The test context shared by the integration tests of requests, and
 * helpers that store requests and history entries directly, for tests that
 * are about reading them.
 */
import { sql } from 'drizzle-orm';

import { request, requestCounter, requestEntry } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import { setupTestContext } from '../../../tests/integration/helpers';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks, as when it called `setupTestContext()` itself.
 */
export const { ctx, db, sent } = setupTestContext();

/** What a stored request may be given; everything else gets a default. */
type RequestValues = Partial<typeof request.$inferInsert>;

/**
 * Stores a request without going through the service, with the next number
 * of the counter (so requests raised afterwards continue from it).
 *
 * @param companyId - The company it's in.
 * @param values - What to store instead of the defaults (a normal bug, open, raised by nobody at the company).
 * @returns The stored request.
 */
export async function storeRequest(companyId: string, values: RequestValues = {}) {
  const counted = await db
    .insert(requestCounter)
    .values({ lastNumber: 1 })
    .onConflictDoUpdate({
      target: requestCounter.singleton,
      set: { lastNumber: sql`${requestCounter.lastNumber} + 1` },
    })
    .returning({ number: requestCounter.lastNumber });
  return firstRow(
    await db
      .insert(request)
      .values({
        number: firstRow(counted, 'the request counter').number,
        companyId,
        title: 'The printer is broken',
        description: 'It prints blank pages.',
        type: 'bug',
        priority: 'normal',
        createdBySide: 'company',
        ...values,
      })
      .returning(),
    'the stored request',
  );
}

/**
 * Stores an entry in a request's history without going through a service.
 *
 * @param requestId - The request.
 * @param values - The entry: a reply by default, written by nobody at the company.
 * @returns The stored entry.
 */
export async function storeEntry(
  requestId: string,
  values: Partial<typeof requestEntry.$inferInsert> = {},
) {
  const change = values.kind !== undefined && values.kind !== 'comment';
  return firstRow(
    await db
      .insert(requestEntry)
      .values({
        requestId,
        kind: 'comment',
        authorSide: 'company',
        body: change ? null : 'Any news?',
        ...values,
      })
      .returning(),
    'the stored entry',
  );
}
