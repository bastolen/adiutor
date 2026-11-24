/**
 * @file Reading the audit log in tests.
 */
import { and, asc, eq, like, type SQL } from 'drizzle-orm';

import type { Database } from '@/db';
import { auditEvent } from '@/db/schema';

/** An audit event as stored. */
type AuditEventRow = typeof auditEvent.$inferSelect;

/** The fields {@link auditEvents} returns when a test doesn't name any. */
type DefaultAuditFields = 'action' | 'actorUserId' | 'targetUserId' | 'companyId' | 'details';

/** The fields {@link auditEvents} returns when a test doesn't name any. */
const DEFAULT_AUDIT_FIELDS: readonly DefaultAuditFields[] = [
  'action',
  'actorUserId',
  'targetUserId',
  'companyId',
  'details',
];

/**
 * Reads the audit log, oldest first (by ID, which is in the order the events
 * were recorded, also for two events of one transaction).
 *
 * @param db - Test database.
 * @param options - Optional details.
 * @param options.action - Only events of this action.
 * @param options.actionLike - Only events whose action matches this `like` pattern.
 * @param options.actorUserId - Only events by this user.
 * @param options.targetUserId - Only events about this user.
 * @param options.fields - The fields to return, to compare them with `toEqual`; the action, actor,
 *   target, company and details by default.
 * @returns The events, each with only those fields.
 */
export async function auditEvents<K extends keyof AuditEventRow = DefaultAuditFields>(
  db: Database,
  options: {
    action?: AuditEventRow['action'];
    actionLike?: string;
    actorUserId?: string;
    targetUserId?: string;
    fields?: readonly K[];
  } = {},
): Promise<Pick<AuditEventRow, K>[]> {
  const conditions: SQL[] = [];
  if (options.action) {
    conditions.push(eq(auditEvent.action, options.action));
  }
  if (options.actionLike) {
    conditions.push(like(auditEvent.action, options.actionLike));
  }
  if (options.actorUserId) {
    conditions.push(eq(auditEvent.actorUserId, options.actorUserId));
  }
  if (options.targetUserId) {
    conditions.push(eq(auditEvent.targetUserId, options.targetUserId));
  }
  const rows = await db
    .select()
    .from(auditEvent)
    .where(and(...conditions))
    .orderBy(asc(auditEvent.id));
  const fields = (options.fields ?? DEFAULT_AUDIT_FIELDS) as readonly K[];
  return rows.map((row) => {
    const picked = {} as Pick<AuditEventRow, K>;
    fields.forEach((field) => {
      picked[field] = row[field];
    });
    return picked;
  });
}
