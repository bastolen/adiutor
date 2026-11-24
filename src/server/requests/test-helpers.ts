/**
 * @file The test context shared by the integration tests of requests,
 * helpers that store requests, people on them and history entries directly,
 * for tests that are about reading them, helpers that read assignees,
 * assignment entries and history back, the five kinds of reader a request
 * can have, and one that deactivates a company while a change is under way.
 * The ones about requests and people are the shared helpers of
 * `tests/integration/helpers`, bound to this context's database.
 */
import { desc, eq } from 'drizzle-orm';

import { company, request, requestEntry, requestType, user } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  actorFor,
  addMember,
  assigneesOf as storedAssigneesOf,
  assignmentsOf as storedAssignmentsOf,
  atTheSameMoment,
  memberActor,
  type RequestValues,
  setupTestContext,
  staffActor,
  storeParticipants,
  storeRequest as storeRequestIn,
} from '../../../tests/integration/helpers';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks, as when it called `setupTestContext()` itself.
 */
export const { ctx, db, sent } = setupTestContext();

/**
 * Stores a request without going through the service, with the next number
 * (`requests.last_number`, so requests raised afterwards continue from it).
 *
 * @param companyId - The company it's in.
 * @param values - What to store instead of the defaults (a normal bug, open, raised by nobody at the company).
 * @returns The stored request.
 */
export async function storeRequest(companyId: string, values: RequestValues = {}) {
  return storeRequestIn(db, companyId, values);
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
 * Every entry in a request's history, oldest first: replies and changes alike.
 *
 * @param requestId - The request.
 * @returns The stored rows.
 */
export async function entriesOf(requestId: string) {
  return db
    .select()
    .from(requestEntry)
    .where(eq(requestEntry.requestId, requestId))
    .orderBy(requestEntry.id);
}

/**
 * The entries in a request's history, in order: replies and changes alike.
 *
 * @param requestId - The request.
 * @returns Each entry as `[kind, from, to, side]`: its kind, the values a change went from and to
 *   (`null` for a reply), and the side of whoever wrote it.
 */
export async function changesOf(requestId: string) {
  const entries = await entriesOf(requestId);
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
  await storeParticipants(db, requestId, userIds, 'assignee');
}

/**
 * Subscribes people to a request without going through a service.
 *
 * @param requestId - The request.
 * @param userIds - The people.
 */
export async function storeSubscribers(
  requestId: string,
  userIds: readonly string[],
): Promise<void> {
  await storeParticipants(db, requestId, userIds, 'subscriber');
}

/**
 * The staff members a request is assigned to, as stored.
 *
 * @param requestId - The request.
 * @returns Their user IDs, sorted.
 */
export async function assigneesOf(requestId: string): Promise<string[]> {
  return storedAssigneesOf(db, requestId);
}

/**
 * The assignment entries in a request's history, in order.
 *
 * @param requestId - The request.
 * @returns Each entry as `[change, subject, author]`: assigned or unassigned, the staff member
 *   it's about (`null` once their account is gone), and who did it (`null` for nobody).
 */
export async function assignmentsOf(requestId: string) {
  return storedAssignmentsOf(db, requestId);
}

/**
 * Sets when a request last had activity, to tell the order of a list or a lane.
 *
 * @param id - The request.
 * @param minutesAgo - How long ago, in minutes.
 */
export async function setActivity(id: string, minutesAgo: number): Promise<void> {
  await db
    .update(request)
    .set({ lastActivityAt: new Date(Date.now() - minutesAgo * 60_000) })
    .where(eq(request.id, id));
}

/**
 * The five kinds of reader a request has, as `it.each` rows: a label, the
 * reader's company role and staff role (either may be `null`), how the
 * request's page addresses them (`audience`), and whether they contribute and
 * manage.
 */
export const REQUEST_READERS = [
  ['a Client', 'client', null, 'contributor', true, false],
  ['a Watcher', 'watcher', null, 'follower', false, false],
  ['Support', null, 'support', 'staff', true, true],
  ['Finance', null, 'finance', 'staff', false, false],
  ['Finance who is also a Client', 'client', 'finance', 'contributor', true, false],
] as const;

/**
 * Creates one of the {@link REQUEST_READERS} and loads them as an actor.
 *
 * @param companyId - The company a company role is held in.
 * @param companyRole - Their role at the company, if any.
 * @param staffRole - Their role on the staff, if any.
 * @returns The actor, loaded after they got their roles.
 */
export async function requestReader(
  companyId: string,
  companyRole: 'client' | 'watcher' | null,
  staffRole: 'support' | 'finance' | null,
) {
  const base = staffRole
    ? await staffActor(db, staffRole)
    : await memberActor(db, companyId, companyRole ?? 'client');
  if (staffRole && companyRole) {
    await addMember(db, companyId, base.id, companyRole);
  }
  return actorFor(db, base.id);
}

/**
 * Stores a request type the staff added, after the built-in ones, without
 * going through a service.
 *
 * @param values - The type: `printers`, starting at Normal, by default.
 * @returns The stored type.
 */
export async function storeRequestType(values: Partial<typeof requestType.$inferInsert> = {}) {
  const [last] = await db
    .select({ position: requestType.position })
    .from(requestType)
    .orderBy(desc(requestType.position))
    .limit(1);
  return firstRow(
    await db
      .insert(requestType)
      .values({
        key: 'printers',
        name: 'Printers',
        description: 'A printer acts up.',
        startingPriority: 'normal',
        position: (last?.position ?? 0) + 1,
        ...values,
      })
      .returning(),
    'the stored type',
  );
}
