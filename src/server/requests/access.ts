/**
 * @file Who sees which requests. Staff see every company's requests; a
 * company's members see their company's, while it's active. A request
 * someone may not see is reported as not found, like its company, so they
 * learn nothing about it.
 */
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { company, request } from '@/db/schema';
import {
  getGlobalPermissions,
  getPermissions,
  getStaffPermissionsInCompanies,
  type Permission,
} from '@/lib/authz/permissions';
import {
  parseRequestNumber,
  requestAudience,
  type RequestAudience,
  type RequestSide,
} from '@/lib/requests';
import { idSchema } from '@/lib/validation';

import { type Company, getCompanyAccess } from '../access';
import type { Actor } from '../actor';
import { notFoundError } from '../errors';

/** A request row. */
export type RequestRow = typeof request.$inferSelect;

/** Which requests someone sees across companies, and how much of them. */
export interface RequestScope {
  /** Whether they see every company's requests: the staff. */
  everyCompany: boolean;
  /** The companies whose requests they see as a member, while those are active. */
  memberOf: string[];
  /** Whether they see what only staff see on a request: its priority. */
  internal: boolean;
}

/**
 * Works out which requests the actor sees across companies.
 *
 * @param actor - The acting user.
 * @returns Their scope.
 */
export function requestScope(actor: Actor): RequestScope {
  const staff = getStaffPermissionsInCompanies(actor);
  const memberOf = Object.entries(actor.memberships)
    .filter(([, companyRole]) =>
      getPermissions({ platformRole: null, companyRole, company: { deactivated: false } }).has(
        'requests:view',
      ),
    )
    .map(([companyId]) => companyId);
  return {
    everyCompany: staff.has('requests:view'),
    memberOf,
    internal: staff.has('requests:view-internal'),
  };
}

/**
 * The condition that keeps a query on `request` joined with `company` to the
 * requests a scope sees.
 *
 * @param scope - The actor's scope.
 * @returns The condition; `undefined` for the staff, who see everything.
 */
export function visibleRequests(scope: RequestScope): SQL | undefined {
  if (scope.everyCompany) {
    return undefined;
  }
  if (scope.memberOf.length === 0) {
    return sql`false`;
  }
  // Members lose access while their company is deactivated.
  return and(inArray(request.companyId, scope.memberOf), isNull(company.deactivatedAt));
}

/** A request with its company and what the actor may do there. */
export interface RequestAccess {
  /** The request. */
  request: RequestRow;
  /** Its company. */
  company: Company;
  /** The actor's permissions in that company. */
  permissions: Set<Permission>;
}

/**
 * Loads a request and the actor's permissions in its company. A request the
 * actor may not see is reported as not found, exactly like one that doesn't
 * exist.
 *
 * The request can be named by its number (as in its address,
 * `/requests/142`) or by its ID.
 *
 * @param db - Database client.
 * @param actor - The acting user.
 * @param ref - The request's number or ID (unvalidated input is fine).
 * @returns The request, its company and the permissions.
 * @throws {ServiceError} `not_found` if it doesn't exist or isn't visible.
 */
export async function getRequestAccess(
  db: Database,
  actor: Actor,
  ref: string,
): Promise<RequestAccess> {
  const byId = idSchema.safeParse(ref);
  const number = byId.success ? null : parseRequestNumber(ref.trim());
  if (!byId.success && number === null) {
    throw notFoundError();
  }
  const [found] = await db
    .select()
    .from(request)
    .where(byId.success ? eq(request.id, byId.data) : eq(request.number, number ?? 0));
  if (!found) {
    throw notFoundError();
  }
  const access = await getCompanyAccess(db, actor, found.companyId);
  if (!access.permissions.has('requests:view')) {
    throw notFoundError();
  }
  return { request: found, ...access };
}

/**
 * How the screens address the actor about a company's requests: as the
 * staff, as someone who takes part, or as a follower (`requestAudience`).
 * It's worked out from their permissions in that company, by the rules
 * {@link getCompanyAccess} uses, for a request's page and for every row of
 * a list alike: someone who is a Client in one company and a Watcher in
 * another reads "waiting for your reply" in the first and "waiting for your
 * company" in the second, on both.
 *
 * @param actor - The reader.
 * @param inCompany - The company the request is in.
 * @param inCompany.id - Its ID.
 * @param inCompany.deactivatedAt - When it was deactivated, or `null` while it's active.
 * @returns The audience.
 */
export function requestAudienceIn(
  actor: Actor,
  inCompany: { id: string; deactivatedAt: Date | null },
): RequestAudience {
  const companyRole = actor.memberships[inCompany.id] ?? null;
  const permissions = getPermissions({
    platformRole: actor.platformRole,
    companyRole,
    company: { deactivated: inCompany.deactivatedAt !== null },
  });
  return requestAudience(permissions, companyRole !== null);
}

/** Someone in a request, as its readers see them: their name and side, never their address. */
export interface RequestPerson {
  /**
   * Their user ID, for readers who may open a user's page (`users:view`: the
   * staff), where their name links to; `null` for everyone else, and when
   * their account is gone. Someone at a company learns nothing about who
   * else is in it beyond the names in its requests.
   */
  userId: string | null;
  /**
   * Their name, trimmed, or `null` when they have none or their account is
   * gone: the screens then name their side (the company, or the staff).
   */
  name: string | null;
  /** The side they acted as: the company, or the staff. */
  side: RequestSide;
  /** Whether they're the one reading. */
  isViewer: boolean;
}

/**
 * Describes someone in a request for its readers.
 *
 * @param person - Their account, as joined to what they wrote.
 * @param person.id - Their user ID, or `null` when the account is gone.
 * @param person.name - Their name, or `null` when the account is gone.
 * @param side - The side they acted as.
 * @param actor - Whoever reads it.
 * @returns The person.
 */
export function requestPerson(
  person: { id: string | null; name: string | null },
  side: RequestSide,
  actor: Actor,
): RequestPerson {
  return {
    userId: getGlobalPermissions(actor).has('users:view') ? person.id : null,
    name: person.name?.trim() || null,
    side,
    isViewer: person.id !== null && person.id === actor.id,
  };
}
