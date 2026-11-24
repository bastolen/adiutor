/**
 * @file Permission checks for services: loads the company (or staff)
 * being acted on and works out what the actor may do there, and checks those
 * rights again inside a change's transaction, as they are by then.
 */
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';

import type { Database, DatabaseTransaction } from '@/db';
import { company, membership, user } from '@/db/schema';
import { grantNeedsConfirmation, type RoleGrant } from '@/lib/authz/guards';
import { needsRecentConfirmation } from '@/lib/authz/mfa';
import {
  getGlobalPermissions,
  getPermissions,
  getStaffPermissionsInCompanies,
  managePermission,
  type Permission,
} from '@/lib/authz/permissions';
import type { PlatformRole } from '@/lib/authz/roles';
import { idSchema, slugSchema } from '@/lib/validation';

import { type Actor, loadActor } from './actor';
import { forbiddenError, notFoundError, ServiceError } from './errors';
import getStaffName from './people/staff-name';

/**
 * The pure permission rules live in `src/lib/authz/permissions.ts`; they're
 * re-exported so services and pages keep importing them from here.
 */
export { getGlobalPermissions, getStaffPermissionsInCompanies, managePermission };

/** A company row. */
export type Company = typeof company.$inferSelect;

/** A company together with what the actor may do in it. */
export interface CompanyAccess {
  /** The company. */
  company: Company;
  /** The actor's permissions there. */
  permissions: Set<Permission>;
}

/**
 * The condition that finds a company by what its address names it with: its
 * ID or its URL name, trimmed and in any case. Only what can be one of the
 * two reaches the database. Anything else (a URL name is lower-case letters,
 * digits and single dashes, `slugSchema`) names no company, and a character
 * Postgres refuses in a query, such as NUL from `/companies/%00`, would be an
 * error instead of "not found".
 *
 * @param companyRef - The company's ID or URL name, as given.
 * @returns The condition, or `null` when it can't name a company.
 */
function companyNamedBy(companyRef: string): SQL | null {
  const reference = companyRef.trim().toLowerCase();
  const id = idSchema.safeParse(reference);
  if (id.success) {
    return eq(company.id, id.data);
  }
  const urlName = slugSchema.safeParse(reference);
  return urlName.success ? eq(company.slug, urlName.data) : null;
}

/**
 * Loads a company and the actor's permissions in it. Companies the actor may
 * not see are reported as not found, so their existence isn't revealed.
 *
 * The company can be named by its ID or its URL name (`company.slug`, in any
 * case), since both work in its address (`/companies/<id>` and
 * `/companies/<URL name>`). A URL name never looks like an ID
 * (`slugSchema`), so the two can't be confused. A reference that can be
 * neither is not found without asking the database ({@link companyNamedBy}).
 *
 * @param db - Database client.
 * @param actor - The acting user.
 * @param companyRef - The company's ID or URL name (unvalidated input is fine).
 * @returns The company and permissions.
 * @throws {ServiceError} `not_found` if it doesn't exist or isn't visible.
 */
export async function getCompanyAccess(
  db: Database,
  actor: Actor,
  companyRef: string,
): Promise<CompanyAccess> {
  const named = companyNamedBy(companyRef);
  if (!named) {
    throw notFoundError();
  }
  const [found] = await db.select().from(company).where(named);
  if (!found) {
    throw notFoundError();
  }

  const permissions = getPermissions({
    platformRole: actor.platformRole,
    companyRole: actor.memberships[found.id] ?? null,
    company: { deactivated: found.deactivatedAt !== null },
  });
  if (!permissions.has('company:view')) {
    throw notFoundError();
  }
  return { company: found, permissions };
}

/**
 * A user's permissions as they are in the database now: globally, or in one
 * company. For a change to the user's own roles, whose actor (loaded at the
 * start of the request) still has the rights from before it, e.g. to tell
 * whether they can still see the page they made it on.
 *
 * @param db - Database client.
 * @param userId - The user.
 * @param companyId - A company, or `null` for the permissions that aren't about one.
 * @returns The permissions; empty without access to the company, or for a
 *   deactivated or unknown user.
 */
export async function currentPermissionsOf(
  db: Database,
  userId: string,
  companyId: string | null,
): Promise<Set<Permission>> {
  const actor = await loadActor(db, userId);
  if (!actor || actor.deactivatedAt) {
    return new Set();
  }
  if (companyId === null) {
    return getGlobalPermissions(actor);
  }
  try {
    return (await getCompanyAccess(db, actor, companyId)).permissions;
  } catch (error) {
    if (error instanceof ServiceError) {
      return new Set();
    }
    throw error;
  }
}

/** Staff or a company, as the target of invitations and invite links. */
export type TargetAccess =
  | {
      /** Joining the staff. */
      target: { type: 'staff' };
      /** No company for staff. */
      company: null;
      /** The staff name. */
      name: string;
      /** Whether the actor may see its invitations and links (`staff:manage`). */
      canView: boolean;
      /** Whether the actor may invite people and manage roles (`staff:manage`). */
      canManage: boolean;
    }
  | {
      /** Joining a company. */
      target: { type: 'company' };
      /** The company. */
      company: Company;
      /** The company's name. */
      name: string;
      /** Whether the actor may see its invitations and links (`members:view`). */
      canView: boolean;
      /** Whether the actor may invite people and manage roles (`members:manage`). */
      canManage: boolean;
    };

/**
 * Loads what invitations and invite links act on: the staff (`companyId` is
 * `null`) or a company, and whether the actor may manage its people.
 *
 * @param db - Database client.
 * @param actor - The acting user.
 * @param companyId - The company, or `null` for staff.
 * @returns The target and the actor's rights.
 * @throws {ServiceError} `not_found` for companies the actor can't see.
 */
export async function getTargetAccess(
  db: Database,
  actor: Actor,
  companyId: string | null,
): Promise<TargetAccess> {
  if (companyId === null) {
    const canManage = getGlobalPermissions(actor).has('staff:manage');
    return {
      target: { type: 'staff' },
      company: null,
      name: await getStaffName(db),
      canView: canManage,
      canManage,
    };
  }
  const access = await getCompanyAccess(db, actor, companyId);
  return {
    target: { type: 'company' },
    company: access.company,
    name: access.company.name,
    canView: access.permissions.has('members:view'),
    canManage: access.permissions.has('members:manage'),
  };
}

/**
 * Refuses a role grant that leaves a lasting way in (a staff role or a higher
 * one, or the company Admin role: `grantNeedsConfirmation`) unless the actor
 * confirmed with their second step in the last 15 minutes
 * (`needsRecentConfirmation`), as changing how they sign in does. Call it
 * after the access checks and before anything is counted or changed.
 *
 * @param actor - The acting user.
 * @param grant - The role being given.
 * @throws {ServiceError} `confirmation_required` with `errors.grantConfirmationRequired`.
 */
export function assertConfirmedForGrant(actor: Actor, grant: RoleGrant): void {
  if (grantNeedsConfirmation(grant) && needsRecentConfirmation(actor)) {
    throw new ServiceError('confirmation_required', 'errors.grantConfirmationRequired');
  }
}

/**
 * Refuses a change while a staff member is signed in as the actor; every
 * service that changes something calls it first (see `./signed-in-as`).
 */
export { default as assertNotSignedInAs } from './signed-in-as';

/**
 * Stops unless a permission is present.
 *
 * @param permissions - The actor's permissions.
 * @param permission - The permission required.
 * @throws {ServiceError} `forbidden` if it's missing.
 */
export function assertPermission(permissions: Set<Permission>, permission: Permission): void {
  if (!permissions.has(permission)) {
    throw forbiddenError();
  }
}

/** A user row as {@link assertStillManages} locked it. */
export interface LockedUser {
  /** Their staff role, as locked. */
  platformRole: PlatformRole | null;
  /** When the account was deactivated, as locked, or `null` while it's active. */
  deactivatedAt: Date | null;
}

/** What {@link assertStillManages} found inside the change's transaction. */
export interface StillManaged {
  /** The locked user rows, by ID (the actor's and `alsoLock`'s that still exist). */
  users: Map<string, LockedUser>;
  /**
   * When the company acted on was deactivated, as the transaction read it
   * (not locked); `null` while it's active, and for the staff. For changes a
   * deactivated company refuses from everyone, the staff included, whose
   * rights don't depend on it: a request's (`changeRequest`, `raiseRequest`).
   */
  companyDeactivatedAt: Date | null;
}

/** Options for {@link assertStillManages}. */
interface StillManagesOptions {
  /**
   * Check only the actor's staff rights in the company, leaving their own
   * membership out (and unlocked): for what only staff may do there, such as
   * adding a member directly.
   */
  asStaff?: boolean;
  /**
   * Other users to lock `FOR SHARE` in the same statement as the actor, such
   * as the user the change is about, so the transaction locks its user rows
   * in one statement, in ID order (see "Lock order" in
   * `docs/security-measures.md`).
   */
  alsoLock?: readonly string[];
}

/**
 * Checks the actor's rights again inside a change's transaction, as they are
 * now rather than as the request loaded them. An `Actor` is read once at the
 * start of a request, so a request already under way when its actor is
 * demoted, removed or deactivated would otherwise still act with the old
 * rights: an invitation or invite link created at that moment would escape
 * `revokeInvitesWithoutManager`.
 *
 * It must be the first statement of the transaction. It locks, in the order
 * every transaction takes them:
 *
 * 1. the actor's `user` row (with `alsoLock`'s, in ID order, in one statement)
 *    `FOR SHARE`;
 * 2. for a company, unless `asStaff`, the actor's `membership` row there
 *    `FOR SHARE` (a new statement).
 *
 * Every change to those rights writes or locks one of those rows more
 * strongly (`setStaffRole` and `soleAdminOf` lock users `FOR UPDATE`,
 * deactivating updates the row, `changeMembership` locks memberships
 * `FOR UPDATE`), so either that change waits until this transaction has
 * committed, and its sweep sees what this one created, or this lock waits
 * for the change and reads its result. The permissions are then worked out
 * from the locked rows with the same rules as {@link getCompanyAccess}. The
 * company's own row is read, not locked: deactivating a company revokes
 * nothing, so acting just before it is no different.
 *
 * What it read of the company is handed back (`companyDeactivatedAt`), so a
 * change that a deactivated company refuses from the staff too can refuse
 * on it without reading the row again. That narrows the time in which such a
 * change can still land after a deactivation to the rest of its
 * transaction; it doesn't close it. Closing it would take a lock on the
 * company's row, and company rows are locked before user rows (see "Lock
 * order" in `docs/security-measures.md`): taking one here, after the user
 * rows, would invite deadlocks.
 *
 * @param tx - The change's transaction.
 * @param actor - The acting user, as the request loaded them. Only their ID is read (their
 *   rights come from the locked rows), so it also takes whoever else a change's rights depend
 *   on: the creator of an invite link whose claim is undone (`claimInviteLink`).
 * @param companyId - The company acted on (an ID already checked), or `null` for staff.
 * @param permission - The permission the change needs.
 * @param options - Options.
 * @param options.asStaff - Check staff rights only (see {@link StillManagesOptions}).
 * @param options.alsoLock - Other users to lock with the actor (see {@link StillManagesOptions}).
 * @returns The locked user rows, and when the company was deactivated, as read just now.
 * @throws {ServiceError} `forbidden` when the actor is gone, deactivated or without the permission
 *   by now; `not_found` when the company is gone.
 */
export async function assertStillManages(
  tx: DatabaseTransaction,
  actor: Pick<Actor, 'id'>,
  companyId: string | null,
  permission: Permission,
  { asStaff = false, alsoLock = [] }: StillManagesOptions = {},
): Promise<StillManaged> {
  // One statement, in ID order: the actor and anyone the change is about.
  const rows = await tx
    .select({ id: user.id, platformRole: user.platformRole, deactivatedAt: user.deactivatedAt })
    .from(user)
    .where(inArray(user.id, [...new Set([actor.id, ...alsoLock])]))
    .orderBy(asc(user.id))
    .for('share');
  const locked = new Map(
    rows.map(({ id, platformRole, deactivatedAt }) => [
      id,
      { platformRole: platformRole ?? null, deactivatedAt },
    ]),
  );
  const self = locked.get(actor.id);
  if (!self || self.deactivatedAt !== null) {
    throw forbiddenError();
  }

  let permissions: Set<Permission>;
  let companyDeactivatedAt: Date | null = null;
  if (companyId === null) {
    permissions = getGlobalPermissions(self);
  } else {
    // A new statement, after the user rows: memberships come after users in the lock order.
    const [own] = asStaff
      ? []
      : await tx
          .select({ role: membership.role })
          .from(membership)
          .where(and(eq(membership.companyId, companyId), eq(membership.userId, actor.id)))
          .for('share');
    const [found] = await tx
      .select({ deactivatedAt: company.deactivatedAt })
      .from(company)
      .where(eq(company.id, companyId));
    if (!found) {
      throw notFoundError();
    }
    companyDeactivatedAt = found.deactivatedAt;
    permissions = getPermissions({
      platformRole: self.platformRole,
      companyRole: own?.role ?? null,
      company: { deactivated: companyDeactivatedAt !== null },
    });
  }
  assertPermission(permissions, permission);
  return { users: locked, companyDeactivatedAt };
}

/**
 * Checks again, inside a change's transaction, that the actor still manages
 * the people the change is about: the staff (`staff:manage`) or a company's
 * members (`members:manage`), whichever `companyId` names. It is
 * {@link assertStillManages} with the permission of {@link managePermission},
 * so a call can't pair `staff:manage` with a company, and like it must be the
 * first statement of the transaction. For invitations and invite links.
 *
 * @param tx - The change's transaction.
 * @param actor - The acting user, or whoever else the change's rights depend on (only their ID
 *   is read; see {@link assertStillManages}).
 * @param companyId - The company acted on (an ID already checked), or `null` for staff.
 * @returns The locked user rows, and when the company was deactivated, as read just now.
 * @throws {ServiceError} `forbidden` when the actor is gone, deactivated or without the permission
 *   by now; `not_found` when the company is gone.
 */
export async function assertStillManagesPeople(
  tx: DatabaseTransaction,
  actor: Pick<Actor, 'id'>,
  companyId: string | null,
): Promise<StillManaged> {
  return assertStillManages(tx, actor, companyId, managePermission(companyId));
}
