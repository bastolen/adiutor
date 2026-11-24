/**
 * @file The audit log: recording security- and permission-relevant events,
 * and listing them for staff (the whole log, or one user's) and, about their
 * own account, for each user.
 */
import { and, count, eq, gte, ilike, inArray, lt, notInArray, or, type SQL } from 'drizzle-orm';
import { alias, type PgColumn, union } from 'drizzle-orm/pg-core';

import type { DatabaseOrTransaction } from '@/db';
import { auditEvent, company, user } from '@/db/schema';
import {
  type AuditAction,
  type AuditGroup,
  AUDIT_GROUPS,
  STAFF_ONLY_AUDIT_ACTIONS,
} from '@/lib/audit-actions';
import { personalDataShown } from '@/lib/authz/impersonation';
import { firstRow } from '@/lib/defined';
import {
  type Paged,
  resolveTableState,
  type SortDirection,
  type TableState,
} from '@/lib/tables/table-state';
import { AUDIT_LOG_TABLE, type AuditLogSort } from '@/lib/tables/tables';

import { assertPermission, getGlobalPermissions } from './access';
import type { Actor } from './actor';
import type { ServiceContext } from './context';
import { orderTerms, paginate } from './pagination';
import containsPattern from './search';

/** An event to record. */
export interface AuditEventInput {
  /** What happened. */
  action: AuditAction;
  /** Who did it, if anyone (signed-out visitors and the system have none). */
  actorUserId?: string | null;
  /** Whose account it was about. */
  targetUserId?: string | null;
  /** Which company it was about. */
  companyId?: string | null;
  /** Extra facts; include names and emails, so they survive deletion. */
  details?: Record<string, unknown>;
}

/**
 * Records an event in the audit log, with the current request's IP address
 * and browser when there is a request. Use the transaction of the change
 * itself when there is one, so the event is saved only if the change is.
 *
 * @param ctx - Service context (for the request info).
 * @param event - What happened.
 * @param db - Database or transaction to write with. Defaults to `ctx.db`.
 * @returns The event's ID, e.g. for a security notice that names its device.
 */
export async function recordEvent(
  ctx: Pick<ServiceContext, 'db' | 'requestInfo'>,
  event: AuditEventInput,
  db: DatabaseOrTransaction = ctx.db,
): Promise<string> {
  const request = ctx.requestInfo ? await ctx.requestInfo().catch(() => null) : null;
  const recorded = await db
    .insert(auditEvent)
    .values({
      action: event.action,
      actorUserId: event.actorUserId ?? null,
      targetUserId: event.targetUserId ?? null,
      companyId: event.companyId ?? null,
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
      details: event.details ?? {},
    })
    .returning({ id: auditEvent.id });
  return firstRow(recorded, 'the recorded event').id;
}

/** An event in the activity timeline. */
export interface AuditEntry {
  /** Event ID. */
  id: string;
  /** When it happened. */
  at: Date;
  /** What happened. */
  action: AuditAction;
  /** Who did it, if known. */
  actor: { id: string; name: string; email: string } | null;
  /** Whose account it was about, if any. */
  target: { id: string; name: string; email: string } | null;
  /** Which company it was about, if any. */
  company: { id: string; name: string } | null;
  /** IP address. */
  ip: string | null;
  /** Browser. */
  userAgent: string | null;
  /** Extra facts. */
  details: Record<string, unknown>;
}

/** The user who acted, joined into audit queries (conditions may refer to it). */
const actorUser = alias(user, 'actor_user');

/** The user an event was about, joined into audit queries (conditions may refer to it). */
const targetUser = alias(user, 'target_user');

/** Which slice of the matching events to load, and in which order. */
interface AuditSlice {
  /** How many to return. */
  limit: number;
  /** How many to skip. Defaults to none. */
  offset?: number;
  /** Newest first (`desc`, the default) or oldest first. */
  dir?: SortDirection;
}

/**
 * Loads audit events with the people and company they're about.
 *
 * @param db - Database client.
 * @param conditions - Which events (they may refer to `actorUser`, `targetUser` and `company`).
 * @param slice - How many, from where, and in which order.
 * @param slice.limit - How many to return.
 * @param slice.offset - How many to skip.
 * @param slice.dir - Newest first (`desc`) or oldest first.
 * @returns The events, newest first unless asked otherwise.
 */
async function queryAuditEntries(
  db: DatabaseOrTransaction,
  conditions: SQL[],
  { limit, offset = 0, dir = 'desc' }: AuditSlice,
): Promise<AuditEntry[]> {
  const rows = await db
    .select({
      event: auditEvent,
      actor: { id: actorUser.id, name: actorUser.name, email: actorUser.email },
      target: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
      company: { id: company.id, name: company.name },
    })
    .from(auditEvent)
    .leftJoin(actorUser, eq(actorUser.id, auditEvent.actorUserId))
    .leftJoin(targetUser, eq(targetUser.id, auditEvent.targetUserId))
    .leftJoin(company, eq(company.id, auditEvent.companyId))
    .where(and(...conditions))
    .orderBy(...orderTerms(dir, auditEvent.at, auditEvent.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    id: row.event.id,
    at: row.event.at,
    action: row.event.action,
    actor: row.actor?.id ? row.actor : null,
    target: row.target?.id ? row.target : null,
    company: row.company?.id ? row.company : null,
    ip: row.event.ip,
    userAgent: row.event.userAgent,
    details: row.event.details,
  }));
}

/**
 * Lists the newest audit events about a user (as actor or target). Staff with
 * `audit:view` only.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `audit:view`.
 * @param userId - Events by or about this user.
 * @param limit - How many to return. Defaults to 50.
 * @returns The events, newest first.
 * @throws {ServiceError} `forbidden` without `audit:view`.
 */
export async function listAuditEvents(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  assertPermission(getGlobalPermissions(actor), 'audit:view');
  /**
   * The newest events whose `column` is the user: a range of its index
   * (`audit_event_actor_idx` / `audit_event_target_idx`), read backwards
   * without sorting.
   *
   * @param column - The actor or the target.
   * @returns The query for their IDs.
   */
  const newest = (column: PgColumn) =>
    ctx.db
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(eq(column, userId))
      .orderBy(...orderTerms('desc', auditEvent.at, auditEvent.id))
      .limit(limit);
  // The newest by them and the newest about them, each bounded, instead of sorting everything an
  // `actor OR target` filter matches; `union` drops an event that's both.
  const conditions: SQL[] = [
    inArray(auditEvent.id, union(newest(auditEvent.actorUserId), newest(auditEvent.targetUserId))),
  ];
  return queryAuditEntries(ctx.db, conditions, { limit });
}

/** What {@link listAuditLog} can be asked for: filters, and the table's sort and page. */
export interface ListAuditLogOptions extends Partial<TableState<AuditLogSort>> {
  /** Text to find in the name or email of who acted or whom it was about, or in the company's name. */
  search?: string;
  /** Only events of this group. */
  group?: AuditGroup;
  /** Only events from this moment on. */
  start?: Date | null;
  /** Only events before this moment. */
  end?: Date | null;
}

/**
 * Lists the whole audit log, a page at a time, newest first by default:
 * every event by or about anyone, with the people and company involved and
 * the IP address and browser it came from. Staff with `audit:view` only.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `audit:view`.
 * @param options - Filters, and the table's sort and page.
 * @returns One page of events, and how many match in all.
 * @throws {ServiceError} `forbidden` without `audit:view`.
 */
export async function listAuditLog(
  ctx: ServiceContext,
  actor: Actor,
  options: ListAuditLogOptions = {},
): Promise<Paged<AuditEntry>> {
  assertPermission(getGlobalPermissions(actor), 'audit:view');
  const { search = '', group, start, end, ...table } = options;
  const state = resolveTableState(AUDIT_LOG_TABLE, table);

  const conditions: SQL[] = [];
  const term = search.trim();
  if (term) {
    const pattern = containsPattern(term);
    const matches = or(
      ilike(actorUser.name, pattern),
      ilike(actorUser.email, pattern),
      ilike(targetUser.name, pattern),
      ilike(targetUser.email, pattern),
      ilike(company.name, pattern),
    );
    if (matches) {
      conditions.push(matches);
    }
  }
  if (group) {
    conditions.push(inArray(auditEvent.action, [...AUDIT_GROUPS[group].actions]));
  }
  if (start) {
    conditions.push(gte(auditEvent.at, start));
  }
  if (end) {
    conditions.push(lt(auditEvent.at, end));
  }

  return paginate(
    state,
    async () => {
      const [row] = await ctx.db
        .select({ total: count() })
        .from(auditEvent)
        .leftJoin(actorUser, eq(actorUser.id, auditEvent.actorUserId))
        .leftJoin(targetUser, eq(targetUser.id, auditEvent.targetUserId))
        .leftJoin(company, eq(company.id, auditEvent.companyId))
        .where(and(...conditions));
      return row?.total ?? 0;
    },
    (limit, offset) => queryAuditEntries(ctx.db, conditions, { limit, offset, dir: state.dir }),
  );
}

/**
 * Lists what happened to the signed-in user's own account (sign-ins, failed
 * attempts, sign-in method and security changes, memberships), newest
 * first, for their account page. Needs no permission: it's only ever about
 * the user themselves. The IP address and browser are only included for
 * what they did themselves, never for anything else: an admin's change,
 * changes made automatically during someone else's request, events whose
 * actor was deleted, or passwords typed for their address (wrong ones, and
 * right ones whose sign-in then asked for a code) and wrong codes typed at
 * that code step, which may be anyone's (all stay in the staff audit log).
 * A staff member signed in as the user gets them only when they see the
 * audit log (`personalDataShown`), as on the user's page.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user, or a staff member signed in as them.
 * @param limit - How many to return. Defaults to 20.
 * @returns The events about them.
 */
export async function listOwnActivity(
  ctx: ServiceContext,
  actor: Actor,
  limit = 20,
): Promise<AuditEntry[]> {
  const { origins } = personalDataShown(actor);
  const entries = await queryAuditEntries(
    ctx.db,
    [
      eq(auditEvent.targetUserId, actor.id),
      // What a staff member did while signed in as them is for the staff who see the audit log.
      notInArray(auditEvent.action, [...STAFF_ONLY_AUDIT_ACTIONS]),
    ],
    { limit },
  );
  // Every event the user caused records them as its actor. Failed sign-ins have none (anyone can
  // send them), nor do passwords waiting for their code and wrong codes at that step (anyone with
  // the password can). The IP address and browser of anyone else are theirs.
  return entries.map((entry) =>
    origins && entry.actor?.id === actor.id ? entry : { ...entry, ip: null, userAgent: null },
  );
}
