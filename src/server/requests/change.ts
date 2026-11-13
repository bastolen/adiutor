/**
 * @file What every change to a request shares: who may make it, and the
 * transaction that makes it. A change checks the actor's rights again as
 * they are by then, locks the request, and only then reads what it changes,
 * so two changes to one request take turns and each sees the other's result.
 */
import { eq, type SQL, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { request } from '@/db/schema';
import type { Permission } from '@/lib/authz/permissions';
import { isClosedStatus, isReopening, type RequestStatus } from '@/lib/requests';

import { assertNotSignedInAs, assertPermission, assertStillManages } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { companyDeactivatedError, notFoundError } from '../errors';
import { getRequestAccess, type RequestAccess, type RequestRow } from './access';

/**
 * The moment a change is made, in the database's clock. Not `now()`, which
 * is when the transaction started: a change that waited for another one
 * would then seem to have come first.
 */
export const CHANGE_MOMENT = sql`clock_timestamp()`;

/**
 * Loads the request a change is about and checks that the actor may make
 * it: not while a staff member is signed in as them, only with the
 * permission, and never in a deactivated company, whose requests can only be
 * read.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param ref - The request's number or ID.
 * @param permission - The permission the change needs.
 * @returns The request, its company and the actor's permissions there.
 * @throws {ServiceError} `signed_in_as`, `not_found` when the actor may not see the request,
 *   `forbidden` without the permission, `invalid` when the company is deactivated.
 */
export async function requestToChange(
  ctx: ServiceContext,
  actor: Actor,
  ref: string,
  permission: Permission,
): Promise<RequestAccess> {
  assertNotSignedInAs(actor);
  const access = await getRequestAccess(ctx.db, actor, ref);
  assertPermission(access.permissions, permission);
  if (access.company.deactivatedAt) {
    throw companyDeactivatedError();
  }
  return access;
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
 * Makes a change to a request in a transaction. First the actor's rights are
 * checked again as they are now (`assertStillManages`, which locks their
 * user and membership rows: before the request, as the lock order asks),
 * then the request's row is locked, and `apply` gets it as it is by then.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param access - The request, as {@link requestToChange} loaded it.
 * @param permission - The permission to check again.
 * @param apply - Makes the change, given the transaction and the locked request.
 * @returns What `apply` returned.
 * @throws {ServiceError} `forbidden` when the actor lost the permission meanwhile.
 */
export function changeRequest<T>(
  ctx: ServiceContext,
  actor: Actor,
  access: RequestAccess,
  permission: Permission,
  apply: (tx: DatabaseTransaction, locked: RequestRow) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    await assertStillManages(tx, actor, access.company.id, permission);
    const [locked] = await tx
      .select()
      .from(request)
      .where(eq(request.id, access.request.id))
      .for('no key update');
    if (!locked) {
      throw notFoundError();
    }
    return apply(tx, locked);
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
export function statusChange(
  from: RequestStatus,
  to: RequestStatus,
): { status: RequestStatus; reopenedAt?: SQL | null; lastActivityAt: SQL } {
  const change = { status: to, lastActivityAt: CHANGE_MOMENT };
  if (isReopening(from, to)) {
    return { ...change, reopenedAt: CHANGE_MOMENT };
  }
  return isClosedStatus(to) ? { ...change, reopenedAt: null } : change;
}
