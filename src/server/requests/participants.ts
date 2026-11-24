/**
 * @file Reading who is on a request: the staff members it's assigned to and
 * its subscribers (`request_participant`), as far as they can still read it.
 * Shared by what changes subscriptions (`subscribers.ts`), what shows a
 * request (`detail.ts`) and what tells the people on it something
 * (`updates.ts`).
 */
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { membership, requestParticipant, user } from '@/db/schema';
import type { PlatformRole } from '@/lib/authz/roles';

import { orderTerms, textOrder } from '../pagination';
import { READING_STAFF_ROLES } from './access';

/** The rows of the people subscribed to a request, among everyone on it. */
export const SUBSCRIBED = eq(requestParticipant.role, 'subscriber');

/** The rows of the people a request is assigned to, among everyone on it. */
export const ASSIGNED = eq(requestParticipant.role, 'assignee');

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
export async function subscribable(
  db: DatabaseOrTransaction,
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
  db: DatabaseOrTransaction,
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
 * Finds everyone on a request who can be told about it: the staff members
 * it's assigned to, while their account is active, and its subscribers who
 * can read it by now ({@link loadSubscribers}).
 *
 * @param db - Database client, or the change's transaction.
 * @param found - The request.
 * @param found.id - Its ID.
 * @param found.companyId - Its company.
 * @returns Their user IDs, each once.
 */
export async function loadPeopleOn(
  db: DatabaseOrTransaction,
  found: { id: string; companyId: string },
): Promise<string[]> {
  const assignees = await db
    .select({ id: user.id })
    .from(requestParticipant)
    .innerJoin(user, eq(requestParticipant.userId, user.id))
    .where(and(eq(requestParticipant.requestId, found.id), ASSIGNED, isNull(user.deactivatedAt)));
  const subscribers = await loadSubscribers(db, found);
  return [...new Set([...assignees, ...subscribers].map(({ id }) => id))];
}
