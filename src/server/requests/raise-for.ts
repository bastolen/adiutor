/**
 * @file Raising a request for someone at a company (decision 0047): who the
 * staff can raise one for, named by their key (`mentionKey`), never a user
 * ID, and finding who a key stands for when the request is raised.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseOrTransaction, DatabaseTransaction } from '@/db';
import { membership, user } from '@/db/schema';
import { getPermissions } from '@/lib/authz/permissions';
import { visibleName } from '@/lib/display-name';
import { MENTION_KEY_LENGTH, requestSide } from '@/lib/requests';

import { assertPermission, getCompanyAccess } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import mentionKey, { byNameThenKey } from './mention-key';

/** The key of the person a request is raised for: empty for whoever raises it. */
export const raisedForSchema = z.string().trim().max(MENTION_KEY_LENGTH);

/** Someone a request can be raised for, as the form lists them. */
export interface RaisableForPerson {
  /** Their key in the company (`mentionKey`), which the form sends. */
  key: string;
  /** Their name. */
  name: string;
}

/**
 * Finds who a request in a company can be raised for: active accounts that
 * are members of the company and could raise it themselves on the
 * company's side (`requests:contribute` there, without `requests:manage`),
 * with a name to show them by (`visibleName`). A Watcher, who can't raise a
 * request, isn't one, and nor is someone whose own request would be the
 * staff's: so never the staff member who raises it for someone.
 *
 * @param db - Database client, or the raising transaction.
 * @param companyId - The company the request is raised in.
 * @param among - Only these users; everyone when left out.
 * @returns The people, with their names as they're shown, in no order.
 */
async function raisableFor(
  db: DatabaseOrTransaction,
  companyId: string,
  among?: readonly string[],
): Promise<{ id: string; name: string }[]> {
  if (among?.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      platformRole: user.platformRole,
      companyRole: membership.role,
    })
    .from(user)
    .innerJoin(membership, and(eq(membership.userId, user.id), eq(membership.companyId, companyId)))
    .where(and(isNull(user.deactivatedAt), among ? inArray(user.id, [...among]) : undefined));
  return rows.flatMap(({ id, name, platformRole, companyRole }) => {
    const permissions = getPermissions({
      platformRole,
      companyRole,
      company: { deactivated: false },
    });
    const shown = visibleName(name);
    return permissions.has('requests:contribute') && requestSide(permissions) === 'company' && shown
      ? [{ id, name: shown }]
      : [];
  });
}

/**
 * Lists who the actor can raise a request in a company for: the people
 * {@link raisableFor} finds, named by their key, by name; never an ID or an
 * address.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the company.
 * @param companyRef - The company's ID or URL name.
 * @returns The people; nobody for a deactivated company, where no request is raised.
 * @throws {ServiceError} `not_found` when the actor may not see the company, `forbidden`
 *   without `requests:manage`.
 */
export async function listRaisableFor(
  ctx: ServiceContext,
  actor: Actor,
  companyRef: string,
): Promise<RaisableForPerson[]> {
  const { company, permissions } = await getCompanyAccess(ctx.db, actor, companyRef);
  assertPermission(permissions, 'requests:manage');
  if (company.deactivatedAt) {
    return [];
  }
  return (await raisableFor(ctx.db, company.id))
    .map(({ id, name }) => ({ key: mentionKey(company.id, id), name }))
    .sort(byNameThenKey);
}

/**
 * The refusal for a key that stands for nobody a request can be raised for.
 *
 * @returns The error.
 */
function notRaisableForError(): ServiceError {
  return new ServiceError('invalid', 'errors.requests.notRaisableFor');
}

/**
 * Finds who a key stands for, among the people a request in the company
 * can be raised for ({@link listRaisableFor}).
 *
 * @param db - Database client.
 * @param companyId - The company the request is raised in.
 * @param key - The person's key there.
 * @returns Their user ID.
 * @throws {ServiceError} `invalid` when the key stands for nobody the request can be raised
 *   for (`errors.requests.notRaisableFor`).
 */
export async function personToRaiseFor(
  db: DatabaseOrTransaction,
  companyId: string,
  key: string,
): Promise<string> {
  const found = (await raisableFor(db, companyId)).find(
    ({ id }) => mentionKey(companyId, id) === key,
  );
  if (!found) {
    throw notRaisableForError();
  }
  return found.id;
}

/**
 * Checks again, in the raising transaction, that a request can still be
 * raised for someone: they may have lost their role, their membership or
 * their account while it was under way. Their user row is locked by then
 * (`assertStillMayChange`'s `alsoLock`), which a change of their account
 * waits for; this locks their membership too (`FOR SHARE`, after the user
 * rows, as the lock order has it), which a change of their role or their
 * removal from the company waits for. A change that came first is read as
 * it is once it's done.
 *
 * @param tx - The raising transaction.
 * @param companyId - The company the request is raised in.
 * @param personId - Who it's raised for.
 * @throws {ServiceError} `invalid` when it can't be raised for them anymore
 *   (`errors.requests.notRaisableFor`).
 */
export async function assertStillRaisableFor(
  tx: DatabaseTransaction,
  companyId: string,
  personId: string,
): Promise<void> {
  await tx
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.companyId, companyId), eq(membership.userId, personId)))
    .for('share');
  if ((await raisableFor(tx, companyId, [personId])).length === 0) {
    throw notRaisableForError();
  }
}
