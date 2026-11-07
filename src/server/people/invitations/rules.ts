/**
 * @file The rules every invitation flow shares: who an invitation is for (a
 * company or the staff), who may manage invitations, which roles may be
 * given, what company users may see, the audit fields and the rate limits.
 */
import { eq, isNull, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { mayRevealAccountExistence } from '@/lib/authz/permissions';
import { isRoleAllowedFor, type Role } from '@/lib/authz/roles';
import type { InviteStatus } from '@/lib/invite-status';
import { CHOOSE_COMPANY_ROLE_MESSAGE, CHOOSE_STAFF_ROLE_MESSAGE } from '@/lib/validation';

import { type TargetAccess } from '../../access';
import type { Actor } from '../../actor';
import type { ServiceContext } from '../../context';
import { companyDeactivatedError, forbiddenError, ServiceError } from '../../errors';
import { assertInviteCompanyLimit, assertInviteSenderLimit } from '../../rate-limit';

/** Where an invitation leads: a company, or staff. */
export interface InviteDestination {
  /** The company, or `null` for staff. */
  companyId: string | null;
  /** The company's or the staff name, for the email. */
  name: string;
}

/**
 * Matches a company column against a company, or against "no company"
 * (the staff).
 *
 * @param column - The `company_id` column.
 * @param companyId - The company, or `null` for staff.
 * @returns The SQL condition.
 */
export function sameTarget(column: PgColumn, companyId: string | null): SQL {
  return companyId === null ? isNull(column) : eq(column, companyId);
}

/**
 * The page someone lands on after joining.
 *
 * @param companyId - The company joined, or `null` for staff.
 * @returns The path.
 */
export function joinedPath(companyId: string | null): string {
  return companyId === null ? '/dashboard' : `/companies/${companyId}`;
}

/**
 * Returns the status to show the actor: the real one for staff,
 * always `sent` for everyone else.
 *
 * @param actor - The acting user.
 * @param status - What actually happened.
 * @returns The status the actor may see.
 */
export function visibleStatus(actor: Actor, status: InviteStatus): InviteStatus {
  return mayRevealAccountExistence(actor.platformRole) ? status : 'sent';
}

/**
 * Stops unless the actor may manage the target's people.
 *
 * @param access - The target and the actor's rights.
 * @throws {ServiceError} `forbidden` without `members:manage` (company) or `staff:manage` (staff).
 */
export function assertCanManage(access: TargetAccess): void {
  if (!access.canManage) {
    throw forbiddenError();
  }
}

/**
 * Stops unless the company, or staff, can receive new people with this
 * role.
 *
 * @param access - The target.
 * @param role - The role to give.
 * @throws {ServiceError} `invalid` if the role doesn't fit or the company is deactivated.
 */
export function assertInvitable(access: TargetAccess, role: Role): void {
  if (!isRoleAllowedFor(access.target, role)) {
    throw new ServiceError(
      'invalid',
      access.target.type === 'staff' ? CHOOSE_STAFF_ROLE_MESSAGE : CHOOSE_COMPANY_ROLE_MESSAGE,
    );
  }
  if (access.company?.deactivatedAt) {
    throw companyDeactivatedError();
  }
}

/**
 * The audit log fields for an event about a target: the company, or a
 * `staff` marker in the details.
 *
 * @param companyId - The company, or `null` for staff.
 * @param details - The event's other details.
 * @returns The `companyId` and the details to record.
 */
export function auditTarget(
  companyId: string | null,
  details: Record<string, unknown> = {},
): { companyId: string | null; details: Record<string, unknown> } {
  return companyId === null
    ? { companyId: null, details: { staff: true, ...details } }
    : { companyId, details };
}

/**
 * Counts an invitation against the limits per sender and per company, so
 * invitations can't be used to flood inboxes.
 *
 * @param ctx - Service context.
 * @param actor - Who's sending it.
 * @param companyId - The company it's for, or `null` for staff.
 * @throws {ServiceError} `rate_limited` when a limit is reached.
 */
export async function assertInviteRateLimits(
  ctx: ServiceContext,
  actor: Actor,
  companyId: string | null,
): Promise<void> {
  await assertInviteSenderLimit(ctx, actor.id);
  await assertInviteCompanyLimit(ctx, companyId);
}
