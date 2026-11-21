/**
 * @file The test context shared by the integration tests of requests,
 * helpers that store requests, assignees and history entries directly, for
 * tests that are about reading them, helpers that read assignees and
 * assignment entries back, and one that deactivates a company while a change
 * is under way.
 */
import { and, eq, sql } from 'drizzle-orm';

import { company, request, requestAssignee, requestCounter, requestEntry, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import { atTheSameMoment, setupTestContext } from '../../../tests/integration/helpers';

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
  const change = values.kind !== undefined && values.kind !== 'comment' && values.kind !== 'note';
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

/**
 * Runs a change whose company is deactivated while it's under way: after
 * the change loaded the company, still active, and before its transaction
 * reads it again. Another transaction holds the actor's row, as a change of
 * their role does; the change waits for it at the start of its own
 * transaction (`assertStillManages`), and the other one deactivates the
 * company before it ends.
 *
 * @param actorId - The acting user.
 * @param companyId - The company to deactivate meanwhile.
 * @param change - The change.
 * @returns How the change ended.
 */
export async function deactivatedMeanwhile<T>(
  actorId: string,
  companyId: string,
  change: () => Promise<T>,
): Promise<PromiseSettledResult<T>> {
  const { second } = await atTheSameMoment(
    db,
    (tx) => tx.select({ id: user.id }).from(user).where(eq(user.id, actorId)).for('update'),
    change,
    async (tx) => {
      await tx.update(company).set({ deactivatedAt: new Date() }).where(eq(company.id, companyId));
    },
  );
  return second;
}

/**
 * Loads a request as it's stored.
 *
 * @param id - The request's ID.
 * @returns The row, or `undefined` when there is none.
 */
export async function storedRequest(id: string) {
  const [found] = await db.select().from(request).where(eq(request.id, id));
  return found;
}

/**
 * The entries in a request's history, in order: replies and changes alike.
 *
 * @param requestId - The request.
 * @returns Each entry as `[kind, from, to, side]`: its kind, the values a change went from and to
 *   (`null` for a reply), and the side of whoever wrote it.
 */
export async function changesOf(requestId: string) {
  const entries = await db
    .select()
    .from(requestEntry)
    .where(eq(requestEntry.requestId, requestId))
    .orderBy(requestEntry.id);
  return entries.map(({ kind, fromValue, toValue, authorSide }) => [
    kind,
    fromValue,
    toValue,
    authorSide,
  ]);
}

/**
 * Assigns staff members to a request without going through the service.
 *
 * @param requestId - The request.
 * @param userIds - The staff members.
 */
export async function storeAssignees(requestId: string, userIds: readonly string[]): Promise<void> {
  await db.insert(requestAssignee).values(userIds.map((userId) => ({ requestId, userId })));
}

/**
 * The staff members a request is assigned to, as stored.
 *
 * @param requestId - The request.
 * @returns Their user IDs, sorted.
 */
export async function assigneesOf(requestId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: requestAssignee.userId })
    .from(requestAssignee)
    .where(eq(requestAssignee.requestId, requestId));
  return rows.map(({ userId }) => userId).sort();
}

/**
 * The assignment entries in a request's history, in order.
 *
 * @param requestId - The request.
 * @returns Each entry as `[change, subject, author]`: assigned or unassigned, the staff member
 *   it's about (`null` once their account is gone), and who did it (`null` for nobody).
 */
export async function assignmentsOf(requestId: string) {
  const entries = await db
    .select()
    .from(requestEntry)
    .where(and(eq(requestEntry.requestId, requestId), eq(requestEntry.kind, 'assignee')))
    .orderBy(requestEntry.id);
  return entries.map(({ toValue, subjectUserId, authorId }) => [toValue, subjectUserId, authorId]);
}
