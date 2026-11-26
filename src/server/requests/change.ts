/**
 * @file What every change to a request shares: who may make it, and the
 * transaction that makes it. A change checks the actor's rights again as
 * they are by then, locks the request, and only then reads what it changes,
 * so two changes to one request take turns and each sees the other's result.
 */
import { and, eq, gt, type SQL, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { impersonation, request, requestEntry } from '@/db/schema';
import type { Permission } from '@/lib/authz/permissions';
import { firstRow } from '@/lib/defined';
import { isClosedStatus, isReopening, type RequestSide, type RequestStatus } from '@/lib/requests';

import { assertPermission, assertStillManages, type LockedUser } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { companyDeactivatedError, notFoundError, ServiceError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { actingUserId, signedInAsWork } from '../signed-in-as';
import { getRequestAccess, type RequestAccess, type RequestRow } from './access';

/**
 * The moment a change is made, in the database's clock. Not `now()`, which
 * is when the transaction started: a change that waited for another one
 * would then seem to have come first. Every entry a change adds to the
 * history is timed with it (`createdAt`, instead of the column's `now()`),
 * and so is the request's last activity. Each statement reads the clock
 * itself, so the times of one change lie microseconds apart, in the order
 * they were written.
 */
export const CHANGE_MOMENT = sql`clock_timestamp()`;

/**
 * Loads the request a change is about and checks that the actor may make
 * it: only with the permission, and never in a deactivated company, whose
 * requests can only be read. An internal request has no company, so only
 * the permission counts. A staff member signed in as the actor may make
 * it too, as the user's own work: the actor's rights decide, and the change
 * records the staff member (`signedInAsWork`, decision 0028).
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param ref - The request's number or ID.
 * @param permission - The permission the change needs.
 * @returns The request, its company (`null` for an internal request) and the actor's
 *   permissions there.
 * @throws {ServiceError} `not_found` when the actor may not see the request,
 *   `forbidden` without the permission, `invalid` when the company is deactivated.
 */
export async function requestToChange(
  ctx: ServiceContext,
  actor: Actor,
  ref: string,
  permission: Permission,
): Promise<RequestAccess> {
  const access = await getRequestAccess(ctx.db, actor, ref);
  assertPermission(access.permissions, permission);
  if (access.company?.deactivatedAt) {
    throw companyDeactivatedError();
  }
  return access;
}

/**
 * Counts a change to a request (anything but a reply or a note: a status, details, assignees,
 * subscribers, an edit, an answer to a solution) against the limit of the one who is really
 * acting (`actingUserId`): a staff member signed in as the actor uses up their own allowance,
 * never the user's. Taken before the change's transaction starts.
 *
 * @param ctx - Service context, or just a database client.
 * @param ctx.db - Where to count it.
 * @param actor - The acting user.
 * @throws {ServiceError} `rate_limited` past `RATE_LIMITS.requestChangesPerUser`.
 */
export async function assertChangeLimit(
  ctx: Pick<ServiceContext, 'db'>,
  actor: Actor,
): Promise<void> {
  await assertRateLimit(
    ctx,
    `request-change:user:${actingUserId(actor)}`,
    RATE_LIMITS.requestChangesPerUser,
  );
}

/**
 * Counts a reply or an internal note against the limit of the one who is really acting
 * (`actingUserId`), like {@link assertChangeLimit} but on the limit for written text. Taken
 * before the change's transaction starts.
 *
 * @param ctx - Service context, or just a database client.
 * @param ctx.db - Where to count it.
 * @param actor - The acting user.
 * @throws {ServiceError} `rate_limited` past `RATE_LIMITS.requestRepliesPerUser`.
 */
export async function assertReplyLimit(
  ctx: Pick<ServiceContext, 'db'>,
  actor: Actor,
): Promise<void> {
  await assertRateLimit(
    ctx,
    `request-reply:user:${actingUserId(actor)}`,
    RATE_LIMITS.requestRepliesPerUser,
  );
}

/**
 * The permission a change by this actor is checked against once more inside
 * its transaction: working on requests for the staff, taking part for
 * everyone else. So staff who stopped working on requests while the change
 * was under way no longer make it with the rights they had.
 *
 * @param permissions - The actor's permissions in the request's company.
 * @returns The permission.
 */
export function workingPermission(permissions: ReadonlySet<Permission>): Permission {
  return permissions.has('requests:manage') ? 'requests:manage' : 'requests:contribute';
}

/**
 * Refuses a change made while signed in as the actor once that sign-in is
 * over: ended, or its time up. The staff member's row of it is read
 * `FOR SHARE`, so it can't end before the change's transaction does (ending
 * it deletes the row). Its time limit is the same check the request's actor
 * passed (`actorSignedInAs`), now in the database's clock.
 *
 * @param tx - The change's transaction.
 * @param actor - The acting user.
 * @throws {ServiceError} `signed_in_as` with `errors.impersonation.ended`.
 */
async function assertStillSignedInAs(tx: DatabaseTransaction, actor: Actor): Promise<void> {
  if (!actor.signedInAs) {
    return;
  }
  const [holds] = await tx
    .select({ id: impersonation.id })
    .from(impersonation)
    .where(
      and(
        eq(impersonation.staffUserId, actor.signedInAs.staffId),
        eq(impersonation.userId, actor.id),
        gt(impersonation.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .limit(1)
    .for('share');
  if (!holds) {
    throw new ServiceError('signed_in_as', 'errors.impersonation.ended');
  }
}

/**
 * Checks, first thing inside the transaction of a change, that the actor
 * still may make it: their rights as they are now (`assertStillManages`,
 * which locks their user and membership rows: before the request, as the
 * lock order asks), the company as that check read it, and, while a staff
 * member is signed in as them, that the sign-in still holds
 * (`assertStillSignedInAs`). The staff keep
 * their rights in a deactivated company, so only this refuses a change of
 * theirs that was under way when the company was deactivated. It narrows
 * that window to the rest of the transaction rather than closing it: the
 * company's row isn't locked, since company rows come before user rows in
 * the lock order.
 *
 * @param tx - The change's transaction.
 * @param actor - The acting user.
 * @param companyId - The request's company (or the one a request is raised in), or `null` for
 *   an internal request, where the actor's staff role alone counts.
 * @param permission - The permission to check again.
 * @param alsoLock - Other users the change is about (the staff members it assigns), locked
 *   `FOR SHARE` in the same statement as the actor, in ID order.
 * @returns The locked user rows, by ID: the actor's and those of `alsoLock` that exist.
 * @throws {ServiceError} `forbidden` when the actor lost the permission meanwhile, `invalid`
 *   when the company was deactivated meanwhile, `signed_in_as` when the sign-in as the actor
 *   ended meanwhile.
 */
export async function assertStillMayChange(
  tx: DatabaseTransaction,
  actor: Actor,
  companyId: string | null,
  permission: Permission,
  alsoLock: readonly string[] = [],
): Promise<Map<string, LockedUser>> {
  const { users, companyDeactivatedAt } = await assertStillManages(
    tx,
    actor,
    companyId,
    permission,
    { alsoLock, internalRequest: companyId === null },
  );
  if (companyDeactivatedAt) {
    throw companyDeactivatedError();
  }
  await assertStillSignedInAs(tx, actor);
  return users;
}

/**
 * Makes a change to a request in a transaction. First the actor's rights
 * and the company are checked again ({@link assertStillMayChange}), then the
 * request's row is locked, and `apply` gets it as it is by then.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param access - The request, as {@link requestToChange} loaded it.
 * @param permission - The permission to check again.
 * @param apply - Makes the change, given the transaction, the locked request and the locked
 *   user rows (the actor's, and those of `options.alsoLock` that exist).
 * @param options - Options.
 * @param options.alsoLock - Other users the change is about, locked with the actor's before
 *   the request (see {@link assertStillMayChange}).
 * @returns What `apply` returned.
 * @throws {ServiceError} `forbidden` when the actor lost the permission meanwhile, `invalid`
 *   when the company was deactivated meanwhile.
 */
export function changeRequest<T>(
  ctx: ServiceContext,
  actor: Actor,
  access: RequestAccess,
  permission: Permission,
  apply: (
    tx: DatabaseTransaction,
    locked: RequestRow,
    users: Map<string, LockedUser>,
  ) => Promise<T>,
  options: { alsoLock?: readonly string[] } = {},
): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const users = await assertStillMayChange(
      tx,
      actor,
      access.company?.id ?? null,
      permission,
      options.alsoLock,
    );
    const [locked] = await tx
      .select()
      .from(request)
      .where(eq(request.id, access.request.id))
      .for('no key update');
    if (!locked) {
      throw notFoundError();
    }
    return apply(tx, locked, users);
  });
}

/**
 * What a new status does to a request's row: the status itself, the moment
 * it was reopened (set when it's worked on again after being closed, cleared
 * when it's closed) and its last activity.
 *
 * @param from - The status it has.
 * @param to - The status it gets.
 * @returns The columns to set.
 */
function statusChange(
  from: RequestStatus,
  to: RequestStatus,
): { status: RequestStatus; reopenedAt?: SQL | null; lastActivityAt: SQL } {
  const change = { status: to, lastActivityAt: CHANGE_MOMENT };
  if (isReopening(from, to)) {
    return { ...change, reopenedAt: CHANGE_MOMENT };
  }
  return isClosedStatus(to) ? { ...change, reopenedAt: null } : change;
}

/**
 * Records a status change in a locked request's history and on its row: the
 * entry, timed with {@link CHANGE_MOMENT}, then the request's new status,
 * reopening time and last activity ({@link statusChange}).
 *
 * @param tx - The change's transaction.
 * @param locked - The request, locked, with the status it has.
 * @param to - The status it gets.
 * @param actor - Who changes it (a staff member signed in as them is recorded too).
 * @param side - The side they take part on.
 * @returns The ID of the entry in the request's history, for the news about it.
 */
export async function recordStatusChange(
  tx: DatabaseTransaction,
  locked: RequestRow,
  to: RequestStatus,
  actor: Actor,
  side: RequestSide,
): Promise<string> {
  const entry = firstRow(
    await tx
      .insert(requestEntry)
      .values({
        requestId: locked.id,
        kind: 'status',
        authorId: actor.id,
        authorSide: side,
        ...signedInAsWork(actor),
        fromValue: locked.status,
        toValue: to,
        createdAt: CHANGE_MOMENT,
      })
      .returning({ id: requestEntry.id }),
    'the status change',
  );
  await tx.update(request).set(statusChange(locked.status, to)).where(eq(request.id, locked.id));
  return entry.id;
}
