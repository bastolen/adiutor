/**
 * @file Members of a company: listing, adding existing users,
 * changing roles and removing.
 * Staff are managed in `staff.ts`.
 */
import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';

import { company, membership, user } from '@/db/schema';
import { isCompanyRoleRaise, wouldLeaveNoAdmin } from '@/lib/authz/guards';
import { getPermissions } from '@/lib/authz/permissions';
import { COMPANY_ADMIN_ROLE, type CompanyRole } from '@/lib/authz/roles';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { MEMBERS_TABLE, type PeopleSort } from '@/lib/tables/tables';
import { companyRoleSchema } from '@/lib/validation';

import {
  assertConfirmedForGrant,
  assertPermission,
  assertStillManages,
  type CompanyAccess,
  getCompanyAccess,
  getGlobalPermissions,
  getStaffPermissionsInCompanies,
  assertNotSignedInAs,
} from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import { withMfaPromotion } from '../auth/mfa-promotion';
import { queueSecurityNotice } from '../auth/security-notices';
import type { ServiceContext } from '../context';
import {
  companyDeactivatedError,
  forbiddenError,
  notFoundError,
  ServiceError,
  parseId,
} from '../errors';
import { paginate, peopleOrder } from '../pagination';
import { addedToCompanyJob, queueJob } from '../queue';
import { assertInviteSenderLimit, assertRoleChangeLimit } from '../rate-limit';
import { revokeInvitationsTo, revokeInvitesWithoutManager } from './invitations';

/** A member as shown on the members page. */
export interface Member {
  /** Membership ID. */
  id: string;
  /** User ID. */
  userId: string;
  /** Display name. */
  name: string;
  /** Email address. */
  email: string;
  /** Role in this company. */
  role: CompanyRole;
  /** When they joined. */
  createdAt: Date;
  /** When they last did something in the app, or `null` if never. */
  lastActiveAt: Date | null;
}

/**
 * Lists a company's members, one page at a time.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:view`.
 * @param companyId - The company.
 * @param options - Sort and page (by default name A to Z, the first page); Joined is when they
 *   joined the company.
 * @returns The page of members.
 */
export async function listMembers(
  ctx: ServiceContext,
  actor: Actor,
  companyId: string,
  options: Partial<TableState<PeopleSort>> = {},
): Promise<Paged<Member>> {
  const access = await getCompanyAccess(ctx.db, actor, companyId);
  assertPermission(access.permissions, 'members:view');
  const state = resolveTableState(MEMBERS_TABLE, options);
  const where = eq(membership.companyId, access.company.id);
  return paginate(
    state,
    () => ctx.db.$count(membership, where),
    (limit, offset) =>
      ctx.db
        .select({
          id: membership.id,
          userId: membership.userId,
          name: user.name,
          email: user.email,
          role: membership.role,
          createdAt: membership.createdAt,
          lastActiveAt: user.lastActiveAt,
        })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(where)
        .orderBy(
          ...peopleOrder(state, {
            name: user.name,
            email: user.email,
            lastActiveAt: user.lastActiveAt,
            joined: membership.createdAt,
            id: membership.id,
          }),
        )
        .limit(limit)
        .offset(offset),
  );
}

/**
 * Changes a member's role or removes them, refusing anything that would leave
 * the company without an active admin, and anything in a deactivated company
 * (reactivate it first). Nobody raises their own role here (they may step
 * down). An admin who loses the role also loses the invitations and links
 * they sent for it, and a removed member the open invitations to the company
 * addressed to them (`revokeInvitationsTo`), so they can't come back through
 * one. Once the change has committed, the member gets a security email
 * (`company_role_changed` or `removed_from_company`, naming the company,
 * without the device or IP address, which would be the actor's), unless they
 * made the change themselves. Choosing the role the member already has
 * changes, records and emails nothing. A role change (not a removal) counts against
 * the actor's limit (`assertRoleChangeLimit`) before the transaction starts.
 *
 * Locks, in the order every transaction takes them (see "Lock order" in
 * `docs/security-measures.md`):
 *
 * 1. the company row (`FOR NO KEY UPDATE`): everything that can take away the
 *    company's last active admin takes it first, deactivating or deleting
 *    an admin too (`soleAdminOf`), so they take turns, and the count below,
 *    a new statement, sees what the one before committed (such as another
 *    admin's deactivation);
 * 2. the actor's and the target's user rows (`FOR SHARE`, in ID order, one
 *    statement);
 * 3. the company's memberships (`FOR UPDATE`);
 * 4. for a demoted admin, the invite links they created
 *    (`revokeInvitesWithoutManager`);
 * 5. for a removal, the per-address lock of the member's address
 *    (`revokeInvitationsTo`).
 *
 * The actor's rights are then worked out again from their rows as locked
 * (their staff role and their membership here), not from the rights the
 * request loaded: a request already under way when its actor was demoted,
 * removed or deactivated is refused, and so is a queued "make me Admin" that
 * would put a demoted Admin back.
 *
 * @param ctx - Service context.
 * @param actor - The acting user, for the audit log.
 * @param access - The company and the actor's permissions there.
 * @param membershipId - The membership to change (unvalidated input is fine).
 * @param newRole - The new role, or `null` to remove the member.
 * @throws {ServiceError} `forbidden` without `members:manage` (as locked) or for raising your own
 *   role, `invalid` in a deactivated company, `not_found` for a membership of another company or
 *   one that's gone, `conflict` for the last active admin, `rate_limited` past the actor's role
 *   changes.
 */
async function changeMembership(
  ctx: ServiceContext,
  actor: Actor,
  access: CompanyAccess,
  membershipId: string,
  newRole: CompanyRole | null,
): Promise<void> {
  assertPermission(access.permissions, 'members:manage');
  if (access.company.deactivatedAt) {
    throw companyDeactivatedError();
  }
  const id = parseId(membershipId);
  // Each change emails the member: limited, so it can't be repeated to flood their inbox.
  if (newRole !== null) {
    await assertRoleChangeLimit(ctx, actor.id);
  }

  const notice = await ctx.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ userId: membership.userId })
      .from(membership)
      .where(and(eq(membership.id, id), eq(membership.companyId, access.company.id)));
    if (!found) {
      throw notFoundError();
    }
    const [locked] = await tx
      .select({ name: company.name, deactivatedAt: company.deactivatedAt })
      .from(company)
      .where(eq(company.id, access.company.id))
      .for('no key update');
    if (!locked) {
      throw notFoundError();
    }
    // Deactivating the company updates this row, so this is exact once it's locked.
    if (locked.deactivatedAt) {
      throw companyDeactivatedError();
    }
    const users = await tx
      .select({
        id: user.id,
        email: user.email,
        platformRole: user.platformRole,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(inArray(user.id, [actor.id, found.userId]))
      .orderBy(asc(user.id))
      .for('share');
    const members = await tx
      .select({
        id: membership.id,
        role: membership.role,
        userId: membership.userId,
        deactivatedAt: user.deactivatedAt,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.companyId, access.company.id))
      .orderBy(asc(membership.id))
      .for('update', { of: membership });
    // Gone if the member's account was deleted meanwhile.
    const target = members.find((member) => member.id === id);
    if (!target) {
      throw notFoundError();
    }
    // Locked above with the actor, so their address can't change before this commits.
    const targetUser = users.find((row) => row.id === target.userId);
    if (!targetUser) {
      throw notFoundError();
    }
    // Already their role (e.g. chosen on a page opened before someone else changed it): nothing
    // to change, record or email, as for staff roles.
    if (target.role === newRole) {
      return null;
    }
    // Nobody raises their own role, even with rights from before a demotion they missed.
    if (target.userId === actor.id && isCompanyRoleRaise(target.role, newRole)) {
      throw new ServiceError('forbidden', 'errors.members.selfRaise');
    }
    // Making someone the company's Admin needs a recent confirmation.
    if (newRole !== null) {
      assertConfirmedForGrant(actor, {
        target: { type: 'company' },
        role: newRole,
        from: target.role,
      });
    }
    // The rights the actor was loaded with may be gone by now: only their rows as locked count
    // (the company is active, checked above).
    const self = users.find((row) => row.id === actor.id);
    const ownRole = members.find((member) => member.userId === actor.id)?.role ?? null;
    if (
      !self ||
      self.deactivatedAt !== null ||
      !getPermissions({
        platformRole: self.platformRole ?? null,
        companyRole: ownRole,
        company: { deactivated: false },
      }).has('members:manage')
    ) {
      throw forbiddenError();
    }

    // Only admins who can still sign in count: a deactivated one can't manage anything.
    const adminCount = members.filter(
      (member) => member.role === COMPANY_ADMIN_ROLE && member.deactivatedAt === null,
    ).length;
    if (
      target.deactivatedAt === null &&
      wouldLeaveNoAdmin({
        adminRole: COMPANY_ADMIN_ROLE,
        adminCount,
        currentRole: target.role,
        newRole,
      })
    ) {
      throw new ServiceError('conflict', 'errors.members.lastAdmin');
    }

    const where = and(eq(membership.id, target.id), eq(membership.companyId, access.company.id));
    // Made Admin: their sessions without MFA that counts for that end (`withMfaPromotion`).
    await withMfaPromotion(
      ctx,
      tx,
      [target.userId],
      async () => {
        if (newRole) {
          await tx.update(membership).set({ role: newRole }).where(where);
        } else {
          await tx.delete(membership).where(where);
        }
        if (target.role === COMPANY_ADMIN_ROLE && newRole !== COMPANY_ADMIN_ROLE) {
          await revokeInvitesWithoutManager(ctx, tx, target.userId);
        }
        // Their open invitations to the company would otherwise let them back in, perhaps with a
        // higher role. After the links above: invite links come before the per-address locks.
        if (!newRole) {
          await revokeInvitationsTo(ctx, tx, targetUser.email, { companyId: access.company.id });
        }
        await recordEvent(
          ctx,
          {
            action: newRole ? 'role_changed' : 'member_removed',
            actorUserId: actor.id,
            targetUserId: target.userId,
            companyId: access.company.id,
            details: newRole ? { from: target.role, to: newRole } : { role: target.role },
          },
          tx,
        );
      },
      { companyId: access.company.id },
    );
    // Nobody is told about their own change (they made it).
    if (target.userId === actor.id) {
      return null;
    }
    return newRole
      ? { userId: target.userId, kind: 'company_role_changed' as const, role: newRole }
      : { userId: target.userId, kind: 'removed_from_company' as const, role: null };
  });

  // Only once the change has committed: a refused or rolled-back change sends nothing.
  if (notice) {
    await queueSecurityNotice(ctx.db, notice.userId, notice.kind, {
      role: notice.role,
      companyId: access.company.id,
    });
  }
}

/**
 * Changes a member's role.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage`.
 * @param input - Form input.
 * @param input.companyId - The company.
 * @param input.membershipId - The membership.
 * @param input.role - The new role; must be a company role (`companyRoleSchema`).
 * @throws {ZodError} For a role that isn't a company role, before anything is looked up.
 * @throws {ServiceError} `rate_limited` past the actor's role changes (`assertRoleChangeLimit`),
 *   and the refusals of `changeMembership`.
 */
export async function changeMemberRole(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string; membershipId: string; role: string },
): Promise<void> {
  assertNotSignedInAs(actor);
  const role = companyRoleSchema.parse(input.role);
  const access = await getCompanyAccess(ctx.db, actor, input.companyId);
  await changeMembership(ctx, actor, access, input.membershipId, role);
}

/**
 * Removes a member from a company. Their account stays.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `members:manage`.
 * @param input - Which member.
 * @param input.companyId - The company.
 * @param input.membershipId - The membership.
 */
export async function removeMember(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string; membershipId: string },
): Promise<void> {
  assertNotSignedInAs(actor);
  const access = await getCompanyAccess(ctx.db, actor, input.companyId);
  await changeMembership(ctx, actor, access, input.membershipId, null);
}

/**
 * Adds an existing user to a company with a role, right away (no
 * invitation), and emails them. Staff only, from the user detail page:
 * company admins invite people instead, so nobody joins a company without
 * accepting. Counts against the sender's invitation limit.
 *
 * The transaction first locks the actor's and the user's rows (`FOR SHARE`,
 * in ID order, one statement, via `assertStillManages`) and checks again,
 * from those rows, that the actor is still staff who may manage members and
 * that the account is still active: neither a demotion nor a deactivation
 * at that moment slips past the checks made when the request started.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs staff `members:manage` (Admins and Managers).
 * @param input - Form input.
 * @param input.companyId - The company.
 * @param input.userId - The user to add.
 * @param input.role - Their role; must be a company role (`companyRoleSchema`).
 * @throws {ZodError} For a role that isn't a company role.
 * @throws {ServiceError} `forbidden` for anyone but staff Admins and Managers (also when the
 *   actor's role is gone by the time the change is made), `invalid` for a deactivated company or
 *   account, `not_found` for an unknown user, `conflict` when already a member.
 */
export async function addMember(
  ctx: ServiceContext,
  actor: Actor,
  input: { companyId: string; userId: string; role: string },
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getStaffPermissionsInCompanies(actor), 'members:manage');
  const role = companyRoleSchema.parse(input.role);
  const access = await getCompanyAccess(ctx.db, actor, input.companyId);
  assertPermission(access.permissions, 'members:manage');
  // Adding someone as the company's Admin needs a recent confirmation.
  assertConfirmedForGrant(actor, { target: { type: 'company' }, role });
  if (access.company.deactivatedAt) {
    throw companyDeactivatedError();
  }
  const id = parseId(input.userId);
  const [target] = await ctx.db
    .select({
      id: user.id,
      email: user.email,
      locale: user.locale,
      deactivatedAt: user.deactivatedAt,
    })
    .from(user)
    .where(eq(user.id, id));
  if (!target) {
    throw notFoundError();
  }
  if (target.deactivatedAt) {
    throw new ServiceError('invalid', 'errors.members.accountDeactivated');
  }
  await assertInviteSenderLimit(ctx, actor.id);

  await ctx.db.transaction(async (tx) => {
    // The actor's staff rights and the account, as they are now: one statement, in ID order.
    const { users: locked } = await assertStillManages(
      tx,
      actor,
      access.company.id,
      'members:manage',
      { asStaff: true, alsoLock: [target.id] },
    );
    const added = locked.get(target.id);
    if (!added) {
      throw notFoundError();
    }
    if (added.deactivatedAt) {
      throw new ServiceError('invalid', 'errors.members.accountDeactivated');
    }
    // Added as Admin: their sessions without MFA that counts for that end (`withMfaPromotion`).
    await withMfaPromotion(
      ctx,
      tx,
      [target.id],
      async () => {
        const inserted = await tx
          .insert(membership)
          .values({ companyId: access.company.id, userId: target.id, role })
          .onConflictDoNothing({ target: [membership.companyId, membership.userId] })
          .returning({ id: membership.id });
        if (inserted.length === 0) {
          throw new ServiceError('conflict', 'errors.members.alreadyMember', {
            company: access.company.name,
          });
        }
        await recordEvent(
          ctx,
          {
            action: 'member_added',
            actorUserId: actor.id,
            targetUserId: target.id,
            companyId: access.company.id,
            details: { role },
          },
          tx,
        );
      },
      { companyId: access.company.id },
    );
  });

  // Queued once the member is added: a mail outage retries it, and never fails the change.
  await queueJob(ctx.db, addedToCompanyJob, {
    userId: target.id,
    companyId: access.company.id,
    role,
    addedBy: actor.id,
  });
}

/** A company a user can still be added to, for the user detail page. */
export interface AddableCompany {
  /** Company ID. */
  id: string;
  /** Company name. */
  name: string;
}

/**
 * Lists the active companies a user isn't a member of yet, by name.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `company:view` (staff).
 * @param userId - The user.
 * @returns The companies.
 */
export async function listAddableCompanies(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<AddableCompany[]> {
  assertPermission(getGlobalPermissions(actor), 'company:view');
  const id = parseId(userId);
  return ctx.db
    .select({ id: company.id, name: company.name })
    .from(company)
    .where(
      and(
        isNull(company.deactivatedAt),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(membership)
            .where(and(eq(membership.companyId, company.id), eq(membership.userId, id))),
        ),
      ),
    )
    .orderBy(asc(company.name));
}
