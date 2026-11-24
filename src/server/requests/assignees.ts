/**
 * @file Assigning a request: the staff members who work on it. A request can
 * have several, or none, and everyone on the request sees them. The staff
 * who work on requests assign any of themselves and remove any of them;
 * someone who stops working on requests is removed from theirs. Every change
 * is an entry in the request's history, one per person.
 */
import { and, asc, count, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseTransaction } from '@/db';
import { company, request, requestParticipant, requestEntry, user } from '@/db/schema';
import { getStaffPermissionsInCompanies } from '@/lib/authz/permissions';
import { PLATFORM_ROLES } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import { visibleName } from '@/lib/display-name';
import { ACTIVE_REQUEST_STATUSES, type AssignmentChange, mayBeAssigned } from '@/lib/requests';
import { idSchema } from '@/lib/validation';

import { assertPermission, type LockedUser } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { orderTerms, textOrder } from '../pagination';
import { signedInAsWork } from '../signed-in-as';
import { requestScope, visibleRequests } from './access';
import { assertChangeLimit, CHANGE_MOMENT, changeRequest, requestToChange } from './change';
import { tellAssigned } from './updates';

/**
 * The most people one change can add, and the most it can remove: more than
 * the staff who could ever be on one request, so a form never reaches it.
 */
export const MAX_ASSIGNEE_CHANGES = 50;

/** The people a change adds or removes: user IDs, at most {@link MAX_ASSIGNEE_CHANGES}. */
const assigneeIdsSchema = z.array(idSchema).max(MAX_ASSIGNEE_CHANGES);

/** The rows of the people a request is assigned to, among everyone on it. */
const ASSIGNED = eq(requestParticipant.role, 'assignee');

/** The staff roles whose members can be assigned: those who work on requests. */
const ASSIGNABLE_ROLES = PLATFORM_ROLES.filter((platformRole) =>
  mayBeAssigned(getStaffPermissionsInCompanies({ platformRole })),
);

/** A staff member who can be assigned to a request, as the staff's controls list them. */
export interface AssignableStaffMember {
  /** Their user ID. */
  id: string;
  /** Their name, trimmed, or `null` when it has nothing to see (`visibleName`). */
  name: string | null;
}

/**
 * Whether a locked user row can be assigned: an active account whose staff
 * role works on requests.
 *
 * @param person - Their row, as the change's transaction locked it, or `undefined` when gone.
 * @returns Whether they can be assigned.
 */
function isAssignable(person: LockedUser | undefined): boolean {
  return (
    person !== undefined &&
    person.deactivatedAt === null &&
    mayBeAssigned(getStaffPermissionsInCompanies(person))
  );
}

/**
 * The history entry of one person assigned or removed.
 *
 * @param requestId - The request.
 * @param subjectUserId - The staff member it's about.
 * @param change - Whether they were assigned or removed.
 * @param author - Who did it (a staff member signed in as them is recorded too), or `null`
 *   when Adiutor did (they stopped working on requests).
 * @returns The entry's values.
 */
function assignmentEntry(
  requestId: string,
  subjectUserId: string,
  change: AssignmentChange,
  author: Actor | null,
) {
  return {
    requestId,
    kind: 'assignee' as const,
    authorId: author?.id ?? null,
    authorSide: 'staff' as const,
    ...(author ? signedInAsWork(author) : {}),
    subjectUserId,
    toValue: change,
    createdAt: CHANGE_MOMENT,
  };
}

/**
 * Adds staff members to a request and removes others. Each person is a
 * change of their own, made while the request is locked: someone already on
 * it isn't added again, someone already off it isn't removed again, and
 * what a colleague did meanwhile about anyone else stays. So nothing is
 * refused because the request changed, and two people who both add the same
 * colleague both get what they asked for. Someone in both lists is added.
 *
 * Whoever is added is locked with the actor (`FOR SHARE`, one statement, in
 * ID order) and checked as they are by then: an active account whose staff
 * role works on requests (`mayBeAssigned`). So a role change, a deactivation
 * or a deletion takes turns with being assigned, and its removal from
 * every request (`unassignFrom`) finds this one too.
 *
 * Every person added or removed gets an entry in the history, and the
 * request's last activity moves: the company sees who's on its requests.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.add - The user IDs to assign.
 * @param input.remove - The user IDs to remove.
 * @returns How many people were added and removed.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request, `forbidden` without `requests:manage`,
 *   `invalid` when the company is deactivated or someone to add can't be assigned
 *   (`errors.requests.notAssignable`), `rate_limited` when the actor has changed requests too
 *   often (`RATE_LIMITS.requestChangesPerUser`).
 * @throws {ZodError} When a list holds something that isn't a user ID, or too many.
 */
export async function changeAssignees(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; add: readonly string[]; remove: readonly string[] },
): Promise<{ added: number; removed: number }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:manage');
  const add = [...new Set(assigneeIdsSchema.parse(input.add))];
  const remove = [...new Set(assigneeIdsSchema.parse(input.remove))].filter(
    (id) => !add.includes(id),
  );
  await assertChangeLimit(ctx, actor);

  return changeRequest(
    ctx,
    actor,
    access,
    'requests:manage',
    async (tx, locked, users) => {
      if (!add.every((id) => isAssignable(users.get(id)))) {
        throw new ServiceError('invalid', 'errors.requests.notAssignable');
      }
      const onIt = new Set(
        (
          await tx
            .select({ userId: requestParticipant.userId })
            .from(requestParticipant)
            .where(and(eq(requestParticipant.requestId, locked.id), ASSIGNED))
        ).map(({ userId }) => userId),
      );
      const adding = add.filter((id) => !onIt.has(id));
      const removing = remove.filter((id) => onIt.has(id));
      if (adding.length === 0 && removing.length === 0) {
        return { added: 0, removed: 0 };
      }
      if (adding.length > 0) {
        await tx.insert(requestParticipant).values(
          adding.map((userId) => ({
            requestId: locked.id,
            userId,
            role: 'assignee' as const,
            createdAt: CHANGE_MOMENT,
          })),
        );
      }
      if (removing.length > 0) {
        await tx
          .delete(requestParticipant)
          .where(
            and(
              eq(requestParticipant.requestId, locked.id),
              inArray(requestParticipant.userId, removing),
              ASSIGNED,
            ),
          );
      }
      const entries = await tx
        .insert(requestEntry)
        .values([
          ...adding.map((id) => assignmentEntry(locked.id, id, 'assigned', actor)),
          ...removing.map((id) => assignmentEntry(locked.id, id, 'unassigned', actor)),
        ])
        .returning({
          id: requestEntry.id,
          subjectUserId: requestEntry.subjectUserId,
          change: requestEntry.toValue,
        });
      // Someone a colleague assigned it to hears of it; being taken off it emails nobody.
      await tellAssigned(
        tx,
        { requestId: locked.id, actorId: actor.id },
        entries.flatMap(({ id, subjectUserId, change }) =>
          change === 'assigned' && subjectUserId !== null
            ? [{ userId: subjectUserId, entryId: id }]
            : [],
        ),
      );
      await tx
        .update(request)
        .set({ lastActivityAt: CHANGE_MOMENT })
        .where(eq(request.id, locked.id));
      return { added: adding.length, removed: removing.length };
    },
    { alsoLock: add },
  );
}

/**
 * Takes someone off every request they're assigned to, because they no
 * longer work on requests: they got a staff role without request work or
 * none (`setStaffRole`), or their account is deactivated or deleted. Each
 * request gets an entry that says so, made by nobody in particular (shown as
 * the staff), and its last activity moves.
 *
 * Call it inside the change's transaction once the person's user row is
 * locked `FOR UPDATE`, after any invitation locks: nobody can assign them
 * meanwhile, since being assigned locks their row too. The requests are
 * locked in ID order, last in the lock order (see "Lock order" in
 * `docs/security-measures.md`), and the rows are removed in a statement of
 * their own once those locks are held, so a colleague's removal of the same
 * person meanwhile isn't recorded twice.
 *
 * @param tx - The change's transaction.
 * @param userId - The person who stops working on requests.
 * @returns How many requests they were taken off.
 */
export async function unassignFrom(tx: DatabaseTransaction, userId: string): Promise<number> {
  const assigned = await tx
    .select({ id: request.id })
    .from(request)
    .where(
      exists(
        tx
          .select({ one: sql`1` })
          .from(requestParticipant)
          .where(
            and(
              eq(requestParticipant.requestId, request.id),
              eq(requestParticipant.userId, userId),
              ASSIGNED,
            ),
          ),
      ),
    )
    .orderBy(asc(request.id))
    .for('no key update');
  if (assigned.length === 0) {
    return 0;
  }
  const removed = await tx
    .delete(requestParticipant)
    .where(
      and(
        eq(requestParticipant.userId, userId),
        ASSIGNED,
        inArray(
          requestParticipant.requestId,
          assigned.map(({ id }) => id),
        ),
      ),
    )
    .returning({ requestId: requestParticipant.requestId });
  if (removed.length === 0) {
    return 0;
  }
  const requestIds = removed.map(({ requestId }) => requestId);
  await tx
    .insert(requestEntry)
    .values(requestIds.map((requestId) => assignmentEntry(requestId, userId, 'unassigned', null)));
  await tx
    .update(request)
    .set({ lastActivityAt: CHANGE_MOMENT })
    .where(inArray(request.id, requestIds));
  return requestIds.length;
}

/**
 * Lists the staff members who can be assigned to a request: active accounts
 * whose staff role works on requests, by name. For the staff's controls and
 * filters: their IDs and names, nothing else.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:view-internal` (the staff).
 * @returns The staff members.
 * @throws {ServiceError} `forbidden` for anyone who isn't staff.
 */
export async function listAssignableStaff(
  ctx: ServiceContext,
  actor: Actor,
): Promise<AssignableStaffMember[]> {
  assertPermission(getStaffPermissionsInCompanies(actor), 'requests:view-internal');
  const rows = await ctx.db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(inArray(user.platformRole, ASSIGNABLE_ROLES), isNull(user.deactivatedAt)))
    .orderBy(...orderTerms('asc', textOrder(user.name), user.id));
  return rows.map(({ id, name }) => ({ id, name: visibleName(name) }));
}

/**
 * Counts the requests the actor is assigned to that still need something:
 * the ones the Active list shows, so a deactivated company's are left out.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @returns The number; 0 for anyone who can't be assigned.
 */
export async function countAssignedRequests(ctx: ServiceContext, actor: Actor): Promise<number> {
  const rows = await ctx.db
    .select({ total: count() })
    .from(requestParticipant)
    .innerJoin(request, eq(request.id, requestParticipant.requestId))
    .innerJoin(company, eq(company.id, request.companyId))
    .where(
      and(
        eq(requestParticipant.userId, actor.id),
        ASSIGNED,
        inArray(request.status, [...ACTIVE_REQUEST_STATUSES]),
        isNull(company.deactivatedAt),
        visibleRequests(requestScope(actor)),
      ),
    );
  return firstRow(rows, 'the assigned request count').total;
}
