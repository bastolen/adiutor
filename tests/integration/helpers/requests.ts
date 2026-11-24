/**
 * @file Storing requests and the people on them directly, for tests that
 * are about something else, and reading back who a request is assigned to.
 */
import { and, eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { request, requestEntry, requestParticipant } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { incrementSetting } from '@/server/settings';

/** What a stored request may be given; everything else gets a default. */
export type RequestValues = Partial<typeof request.$inferInsert>;

/**
 * Stores a request without going through the service, with the next number
 * (`requests.last_number`, so requests raised afterwards continue from it).
 *
 * @param db - Test database.
 * @param companyId - The company it's in.
 * @param values - What to store instead of the defaults (a normal bug, open, raised by nobody at the company).
 * @returns The stored request.
 */
export async function storeRequest(db: Database, companyId: string, values: RequestValues = {}) {
  return db.transaction(async (tx) => {
    const { value: number } = await incrementSetting(tx, 'requests.last_number');
    return firstRow(
      await tx
        .insert(request)
        .values({
          number,
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
  });
}

/**
 * Puts people on a request without going through a service.
 *
 * @param db - Test database.
 * @param requestId - The request.
 * @param userIds - The people.
 * @param role - Whether they're assigned to it or subscribed to it.
 */
export async function storeParticipants(
  db: Database,
  requestId: string,
  userIds: readonly string[],
  role: 'assignee' | 'subscriber',
): Promise<void> {
  if (userIds.length > 0) {
    await db
      .insert(requestParticipant)
      .values(userIds.map((userId) => ({ requestId, userId, role })));
  }
}

/**
 * The staff members a request is assigned to, as stored.
 *
 * @param db - Test database.
 * @param requestId - The request.
 * @returns Their user IDs, sorted.
 */
export async function assigneesOf(db: Database, requestId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: requestParticipant.userId })
    .from(requestParticipant)
    .where(
      and(eq(requestParticipant.requestId, requestId), eq(requestParticipant.role, 'assignee')),
    );
  return rows.map(({ userId }) => userId).sort();
}

/**
 * The assignment entries in a request's history, in order.
 *
 * @param db - Test database.
 * @param requestId - The request.
 * @returns Each entry as `[change, subject, author]`: assigned or unassigned, the staff member
 *   it's about (`null` once their account is gone), and who did it (`null` for nobody).
 */
export async function assignmentsOf(db: Database, requestId: string) {
  const entries = await db
    .select()
    .from(requestEntry)
    .where(and(eq(requestEntry.requestId, requestId), eq(requestEntry.kind, 'assignee')))
    .orderBy(requestEntry.id);
  return entries.map(({ toValue, subjectUserId, authorId }) => [toValue, subjectUserId, authorId]);
}
