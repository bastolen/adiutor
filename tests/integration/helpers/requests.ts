/**
 * @file Storing requests and the people on them directly, and reading back
 * who a request is assigned to.
 */
import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { request, requestEntry, requestParticipant } from '@/db/schema';
import { firstRow } from '@/lib/defined';

/**
 * Stores a request with staff members assigned to it, without going through
 * the services: for the tests of what happens to someone's assignments
 * elsewhere (a role change, a deactivation, a deletion). Its number is the
 * next free one.
 *
 * @param db - Test database.
 * @param companyId - The company it's in.
 * @param assigneeIds - The staff members assigned to it.
 * @returns The request's ID.
 */
export async function storeAssignedRequest(
  db: Database,
  companyId: string,
  assigneeIds: readonly string[],
): Promise<string> {
  const stored = firstRow(
    await db
      .insert(request)
      .values({
        number: sql`coalesce((select max(${request.number}) from ${request}), 0) + 1`,
        companyId,
        title: 'The printer is broken',
        description: 'It prints blank pages.',
        type: 'bug',
        priority: 'normal',
        createdBySide: 'company',
      })
      .returning({ id: request.id }),
    'the stored request',
  );
  if (assigneeIds.length > 0) {
    await db
      .insert(requestParticipant)
      .values(
        assigneeIds.map((userId) => ({ requestId: stored.id, userId, role: 'assignee' as const })),
      );
  }
  return stored.id;
}

/**
 * Reads who a request is assigned to, and the assignment lines in its
 * history.
 *
 * @param db - Test database.
 * @param requestId - The request.
 * @returns The assignees' user IDs, sorted, and each assignment entry as `[change, subject,
 *   author]` in order.
 */
export async function assignmentsOfRequest(db: Database, requestId: string) {
  const assignees = await db
    .select({ userId: requestParticipant.userId })
    .from(requestParticipant)
    .where(
      and(eq(requestParticipant.requestId, requestId), eq(requestParticipant.role, 'assignee')),
    );
  const entries = await db
    .select()
    .from(requestEntry)
    .where(eq(requestEntry.requestId, requestId))
    .orderBy(asc(requestEntry.id));
  return {
    assignees: assignees.map(({ userId }) => userId).sort(),
    entries: entries
      .filter(({ kind }) => kind === 'assignee')
      .map(({ toValue, subjectUserId, authorId }) => [toValue, subjectUserId, authorId]),
  };
}
