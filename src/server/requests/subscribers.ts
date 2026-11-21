/**
 * @file Who is subscribed to a request: the people who follow it, next to
 * the staff members it's assigned to. Everyone on a request (assigned or
 * subscribed, rows of `request_participant`) is who the emails about it
 * reach (`updates.ts`).
 *
 * - **Who can be subscribed:** an active account that can read the request:
 *   a staff member who reads requests, or someone at the request's company.
 * - **Who changes it:** everyone subscribes and unsubscribes themselves; the
 *   staff who work on requests do so for anyone, and a company's Admins for
 *   their colleagues (`subscriberScope`).
 * - **Automatically:** whoever raises a request, replies to it or is
 *   mentioned in it is subscribed ({@link subscribeAutomatically}), and can
 *   unsubscribe. Replying or being mentioned again subscribes them again.
 * - **Losing access ends it** ({@link unsubscribeFrom}).
 * - **No user ID reaches a company's browser:** the dialog that changes
 *   subscribers names each person by their key in the request's company
 *   (`mentionKey`), for the staff and a company's Admins alike.
 *
 * Subscribing is a preference, not work on the request: it leaves no entry
 * in the history and doesn't count as activity.
 */
import { and, eq, exists, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database, DatabaseTransaction } from '@/db';
import { membership, request, requestParticipant, user } from '@/db/schema';
import type { PlatformRole } from '@/lib/authz/roles';
import { visibleName } from '@/lib/display-name';
import {
  MENTION_KEY_LENGTH,
  type RequestParticipantRole,
  type SubscriberScope,
  subscriberScope,
} from '@/lib/requests';

import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { forbiddenError, ServiceError } from '../errors';
import { orderTerms, textOrder } from '../pagination';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { actingUserId } from '../signed-in-as';
import { getRequestAccess, READING_STAFF_ROLES } from './access';
import { CHANGE_MOMENT, changeRequest, requestToChange } from './change';
import mentionKey from './mention-key';

/** The rows of the people subscribed to a request, among everyone on it. */
const SUBSCRIBED = eq(requestParticipant.role, 'subscriber');

/** The most people one change subscribes or unsubscribes. */
export const MAX_SUBSCRIBER_CHANGES = 50;

/** The keys of a change: at most {@link MAX_SUBSCRIBER_CHANGES}, none longer than a key is. */
const subscriberKeysSchema = z
  .array(z.string().max(MENTION_KEY_LENGTH))
  .max(MAX_SUBSCRIBER_CHANGES);

/** Someone who can be subscribed to a request, as the dialog that changes subscribers lists them. */
export interface SubscribablePerson {
  /**
   * What stands for them in the dialog (`mentionKey`): only valid in the
   * request's company, and it says nothing about who they are. Never a user
   * ID, which a company's Admin doesn't get.
   */
  key: string;
  /** Their name. */
  name: string;
  /** Whether they're on the staff's side; the list gives them the staff's label. */
  staff: boolean;
  /** Whether they're subscribed now. */
  subscribed: boolean;
  /** Whether they're the one who asked for the list. */
  isViewer: boolean;
}

/** Someone who can be subscribed in a company, as the services know them. */
export interface Subscribable {
  /** Their user ID. */
  id: string;
  /** Their name, as it's stored. */
  name: string | null;
  /** Whether they read requests as a staff member. */
  staff: boolean;
  /** Whether they're a member of the company. */
  member: boolean;
}

/**
 * What makes an account one that can be subscribed to a company's requests,
 * for a query on `user` left-joined with their `membership` of that company:
 * it's active, and reads the requests as a staff member or as a member.
 */
const READS_REQUESTS = and(
  isNull(user.deactivatedAt),
  or(inArray(user.platformRole, READING_STAFF_ROLES), isNotNull(membership.id)),
);

/**
 * Describes a found account as the services know it.
 *
 * @param row - The account, with its membership of the requests' company.
 * @param row.id - Their user ID.
 * @param row.name - Their name, as it's stored.
 * @param row.platformRole - Their staff role, or `null`.
 * @param row.membershipId - Their membership of the company, or `null`.
 * @returns The person.
 */
function asSubscribable(row: {
  id: string;
  name: string | null;
  platformRole: PlatformRole | null;
  membershipId: string | null;
}): Subscribable {
  return {
    id: row.id,
    name: row.name,
    staff: row.platformRole !== null && READING_STAFF_ROLES.includes(row.platformRole),
    member: row.membershipId !== null,
  };
}

/** The columns {@link asSubscribable} reads. */
const SUBSCRIBABLE_COLUMNS = {
  id: user.id,
  name: user.name,
  platformRole: user.platformRole,
  membershipId: membership.id,
};

/**
 * Finds who can be subscribed to a company's requests: active accounts that
 * read them, as a staff member or as a member of the company.
 *
 * @param db - Database client, or the change's transaction.
 * @param companyId - The requests' company.
 * @param among - Only these users; everyone when left out.
 * @returns The people, in no order.
 */
async function subscribable(
  db: Database | DatabaseTransaction,
  companyId: string,
  among?: readonly string[],
): Promise<Subscribable[]> {
  if (among?.length === 0) {
    return [];
  }
  const rows = await db
    .select(SUBSCRIBABLE_COLUMNS)
    .from(user)
    .leftJoin(membership, and(eq(membership.userId, user.id), eq(membership.companyId, companyId)))
    .where(and(READS_REQUESTS, among ? inArray(user.id, [...among]) : undefined));
  return rows.map(asSubscribable);
}

/**
 * Loads who is subscribed to a request, by name: for whoever shows them, and
 * for whoever tells them something later. Only the people who can read the
 * request by now count. Losing access ends a subscription
 * ({@link unsubscribeFrom}), but a row can be left behind when that happens
 * in the moment someone is subscribed, and such a row is never shown or
 * used.
 *
 * @param db - Database client.
 * @param found - The request.
 * @param found.id - Its ID.
 * @param found.companyId - Its company.
 * @returns The subscribers, by name.
 */
export async function loadSubscribers(
  db: Database | DatabaseTransaction,
  found: { id: string; companyId: string },
): Promise<Subscribable[]> {
  const rows = await db
    .select(SUBSCRIBABLE_COLUMNS)
    .from(requestParticipant)
    .innerJoin(user, eq(requestParticipant.userId, user.id))
    .leftJoin(
      membership,
      and(eq(membership.userId, user.id), eq(membership.companyId, found.companyId)),
    )
    .where(and(eq(requestParticipant.requestId, found.id), SUBSCRIBED, READS_REQUESTS))
    .orderBy(...orderTerms('asc', textOrder(user.name), user.id));
  return rows.map(asSubscribable);
}

/**
 * Records a change of subscriptions made while a staff member is signed in as
 * the actor, in the audit log: it leaves no entry in the request's history,
 * so this is where it shows who really made it (decision 0025). Only staff
 * who see the audit log read it; the user's own Recent activity leaves it
 * out (`STAFF_ONLY_AUDIT_ACTIONS`). Nothing is recorded for the user's own
 * changes.
 *
 * @param ctx - Service context (for the request's IP address and browser).
 * @param tx - The change's transaction.
 * @param actor - The acting user.
 * @param locked - The request, as it's locked.
 * @param locked.id - Its ID.
 * @param locked.number - Its number.
 * @param locked.companyId - Its company.
 * @param change - Who was subscribed and unsubscribed (user IDs).
 * @param change.subscribed - Who was subscribed.
 * @param change.unsubscribed - Who was unsubscribed.
 */
async function recordWorkWhileSignedInAs(
  ctx: ServiceContext,
  tx: DatabaseTransaction,
  actor: Actor,
  locked: { id: string; number: number; companyId: string },
  { subscribed = [], unsubscribed = [] }: { subscribed?: string[]; unsubscribed?: string[] },
): Promise<void> {
  if (!actor.signedInAs) {
    return;
  }
  await recordEvent(
    ctx,
    {
      action: 'request_subscribers_changed',
      actorUserId: actor.signedInAs.staffId,
      targetUserId: actor.id,
      companyId: locked.companyId,
      details: {
        request: locked.number,
        requestId: locked.id,
        subscribed,
        unsubscribed,
        // Names, so the line survives the accounts' deletion.
        staffMember: actor.signedInAs.staffName,
        signedInAs: { name: actor.name, email: actor.email },
      },
    },
    tx,
  );
}

/**
 * Subscribes the actor to a request.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:view` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @returns Whether they weren't subscribed before.
 * @throws {ServiceError} `not_found` when the actor may not see the request, `invalid` when the company is
 *   deactivated, `rate_limited` when the actor has changed requests too often
 *   (`RATE_LIMITS.requestChangesPerUser`).
 */
export async function subscribe(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string },
): Promise<{ subscribed: boolean }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:view');
  await assertRateLimit(
    ctx,
    `request-change:user:${actingUserId(actor)}`,
    RATE_LIMITS.requestChangesPerUser,
  );
  return changeRequest(ctx, actor, access, 'requests:view', async (tx, locked) => {
    const added = await tx
      .insert(requestParticipant)
      .values({
        requestId: locked.id,
        userId: actor.id,
        role: 'subscriber',
        createdAt: CHANGE_MOMENT,
      })
      .onConflictDoNothing()
      .returning({ id: requestParticipant.id });
    if (added.length > 0) {
      await recordWorkWhileSignedInAs(ctx, tx, actor, locked, { subscribed: [actor.id] });
    }
    return { subscribed: added.length > 0 };
  });
}

/**
 * Unsubscribes the actor from a request. Someone it's assigned to stays
 * assigned: that's what an assignee gets updates as.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:view` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @returns Whether they were subscribed before.
 * @throws {ServiceError} As {@link subscribe}.
 */
export async function unsubscribe(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string },
): Promise<{ unsubscribed: boolean }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:view');
  await assertRateLimit(
    ctx,
    `request-change:user:${actingUserId(actor)}`,
    RATE_LIMITS.requestChangesPerUser,
  );
  return changeRequest(ctx, actor, access, 'requests:view', async (tx, locked) => {
    const removed = await tx
      .delete(requestParticipant)
      .where(
        and(
          eq(requestParticipant.requestId, locked.id),
          eq(requestParticipant.userId, actor.id),
          SUBSCRIBED,
        ),
      )
      .returning({ id: requestParticipant.id });
    if (removed.length > 0) {
      await recordWorkWhileSignedInAs(ctx, tx, actor, locked, { unsubscribed: [actor.id] });
    }
    return { unsubscribed: removed.length > 0 };
  });
}

/**
 * Whether someone's subscription is within a scope: anyone who can be
 * subscribed for the staff who work on requests, the company's own people
 * for its Admins.
 *
 * @param scope - Whose subscriptions the actor may change.
 * @param person - Someone who can be subscribed.
 * @returns Whether they're in it.
 */
function inScope(scope: SubscriberScope, person: Subscribable): boolean {
  return scope === 'everyone' || (scope === 'colleagues' && person.member);
}

/**
 * Subscribes people to a request and unsubscribes others, each a change of
 * its own: someone subscribed already isn't added again, and someone who
 * isn't subscribed isn't removed. Someone in both lists is added.
 *
 * People are named by their key in the request's company (`mentionKey`, as
 * {@link listSubscribable} gives it), never by a user ID. Whose
 * subscriptions the actor may change is their scope (`subscriberScope`):
 * everyone's for the staff who work on requests, their colleagues' for a
 * company's Admins. A key to add must stand for someone in that scope, who
 * is then locked with the actor (`FOR SHARE`) and checked again as they are
 * by then: an active account that reads the request. A key to remove that
 * stands for nobody in the scope is left alone without a word, so a
 * company's Admin learns nothing about which staff members follow a request.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the request's company (the staff),
 *   or `members:manage` (a company's Admins).
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.add - The keys of the people to subscribe.
 * @param input.remove - The keys of the people to unsubscribe.
 * @returns How many people were added and removed.
 * @throws {ServiceError} `not_found` when the actor may not see the request, `forbidden` for someone who may only
 *   change their own subscription, `invalid` when the company is deactivated or a key to add
 *   stands for nobody the actor can subscribe (`errors.requests.notSubscribable`),
 *   `rate_limited` when the actor has changed requests too often
 *   (`RATE_LIMITS.requestChangesPerUser`).
 * @throws {ZodError} When a list holds something that can't be a key, or too many.
 */
export async function changeSubscribers(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; add: readonly string[]; remove: readonly string[] },
): Promise<{ added: number; removed: number }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:view');
  const scope = subscriberScope(access.permissions);
  if (scope === 'self') {
    throw forbiddenError();
  }
  const addKeys = [...new Set(subscriberKeysSchema.parse(input.add))];
  const removeKeys = [...new Set(subscriberKeysSchema.parse(input.remove))].filter(
    (key) => !addKeys.includes(key),
  );
  await assertRateLimit(
    ctx,
    `request-change:user:${actingUserId(actor)}`,
    RATE_LIMITS.requestChangesPerUser,
  );

  // Who the keys stand for, among the people whose subscription is the actor's to change.
  const companyId = access.company.id;
  const offered = new Map(
    (await subscribable(ctx.db, companyId))
      .filter((person) => inScope(scope, person))
      .map(({ id }) => [mentionKey(companyId, id), id]),
  );
  const add = addKeys.flatMap((key) => offered.get(key) ?? []);
  if (add.length < addKeys.length) {
    throw new ServiceError('invalid', 'errors.requests.notSubscribable');
  }
  const remove = removeKeys.flatMap((key) => offered.get(key) ?? []);

  return changeRequest(
    ctx,
    actor,
    access,
    scope === 'everyone' ? 'requests:manage' : 'members:manage',
    async (tx, locked) => {
      // As they are by now, with their rows locked: still someone the actor can subscribe.
      const still = await subscribable(tx, locked.companyId, add);
      if (still.length < add.length || !still.every((person) => inScope(scope, person))) {
        throw new ServiceError('invalid', 'errors.requests.notSubscribable');
      }
      const added =
        add.length === 0
          ? []
          : await tx
              .insert(requestParticipant)
              .values(
                add.map((userId) => ({
                  requestId: locked.id,
                  userId,
                  role: 'subscriber' as const,
                  createdAt: CHANGE_MOMENT,
                })),
              )
              .onConflictDoNothing()
              .returning({ userId: requestParticipant.userId });
      const removed =
        remove.length === 0
          ? []
          : await tx
              .delete(requestParticipant)
              .where(
                and(
                  eq(requestParticipant.requestId, locked.id),
                  inArray(requestParticipant.userId, remove),
                  SUBSCRIBED,
                ),
              )
              .returning({ userId: requestParticipant.userId });
      if (added.length > 0 || removed.length > 0) {
        await recordWorkWhileSignedInAs(ctx, tx, actor, locked, {
          subscribed: added.map(({ userId }) => userId),
          unsubscribed: removed.map(({ userId }) => userId),
        });
      }
      return { added: added.length, removed: removed.length };
    },
    { alsoLock: add },
  );
}

/**
 * Lists whose subscription to a request the actor may change, for the
 * dialog that changes subscribers: everyone who can be subscribed for the
 * staff who work on requests, their colleagues for a company's Admins. By
 * name, each with their key in the request's company and whether they're
 * subscribed now; never a user ID. Someone without a name to show
 * isn't listed; they can still subscribe themselves. Neither is someone the
 * request is assigned to: they follow it as that, and the request lists them
 * as that.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the request's company, or
 *   `members:manage`.
 * @param ref - The request's number or ID.
 * @returns The people.
 * @throws {ServiceError} `not_found` when the actor may not see the request, `forbidden` for
 *   someone who may only change their own subscription.
 */
export async function listSubscribable(
  ctx: ServiceContext,
  actor: Actor,
  ref: string,
): Promise<SubscribablePerson[]> {
  const { request: found, company, permissions } = await getRequestAccess(ctx.db, actor, ref);
  const scope = subscriberScope(permissions);
  if (scope === 'self') {
    throw forbiddenError();
  }
  const [people, onRequest] = await Promise.all([
    subscribable(ctx.db, company.id),
    ctx.db
      .select({ userId: requestParticipant.userId, role: requestParticipant.role })
      .from(requestParticipant)
      .where(eq(requestParticipant.requestId, found.id)),
  ]);
  /**
   * The people on the request with a role.
   *
   * @param as - The role.
   * @returns Their user IDs.
   */
  const usersWith = (as: RequestParticipantRole) =>
    new Set(onRequest.flatMap(({ userId, role }) => (role === as ? [userId] : [])));
  const subscribed = usersWith('subscriber');
  const assigned = usersWith('assignee');
  return people
    .filter((person) => !assigned.has(person.id) && inScope(scope, person))
    .flatMap(({ id, name, staff }) => {
      const shown = visibleName(name);
      return shown === null
        ? []
        : [
            {
              key: mentionKey(company.id, id),
              name: shown,
              staff: scope === 'everyone' && staff,
              subscribed: subscribed.has(id),
              isViewer: id === actor.id,
            },
          ];
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key),
    );
}

/**
 * Subscribes people to a request because of what they did or what was said
 * to them: they raised it, replied to it, or are mentioned in it. Called in
 * the transaction of that change. Someone subscribed already stays as they
 * are; someone who unsubscribed is subscribed again.
 *
 * @param tx - The change's transaction.
 * @param requestId - The request.
 * @param userIds - The people, who can all read the request.
 */
export async function subscribeAutomatically(
  tx: DatabaseTransaction,
  requestId: string,
  userIds: readonly string[],
): Promise<void> {
  const people = [...new Set(userIds)];
  if (people.length === 0) {
    return;
  }
  await tx
    .insert(requestParticipant)
    .values(
      people.map((userId) => ({
        requestId,
        userId,
        role: 'subscriber' as const,
        createdAt: CHANGE_MOMENT,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Takes someone off the requests they're subscribed to and can no longer
 * read: all of them once their account is deactivated, and otherwise those
 * of the companies they aren't in, unless they read requests as a staff
 * member. Call it inside the change's transaction after the change itself
 * (the membership removed, the staff role or the deactivation saved): it
 * goes by what the person can read by then. A deleted account takes its
 * rows with it.
 *
 * @param tx - The change's transaction.
 * @param userId - The person whose access changed.
 * @returns How many requests they were taken off.
 */
export async function unsubscribeFrom(tx: DatabaseTransaction, userId: string): Promise<number> {
  const stillReads = exists(
    tx
      .select({ one: sql`1` })
      .from(user)
      .where(
        and(
          eq(user.id, userId),
          isNull(user.deactivatedAt),
          or(
            inArray(user.platformRole, READING_STAFF_ROLES),
            exists(
              tx
                .select({ one: sql`1` })
                .from(membership)
                .innerJoin(request, eq(request.companyId, membership.companyId))
                .where(
                  and(eq(membership.userId, userId), eq(request.id, requestParticipant.requestId)),
                ),
            ),
          ),
        ),
      ),
  );
  const removed = await tx
    .delete(requestParticipant)
    .where(and(eq(requestParticipant.userId, userId), SUBSCRIBED, not(stillReads)))
    .returning({ id: requestParticipant.id });
  return removed.length;
}
