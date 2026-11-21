/**
 * @file Staff: its name and other settings, and its people (users with a platform role).
 * Invitations and invite links for staff are in `invitations/` and
 * `invite-links.ts` (with no company). Managing the staff needs
 * `staff:manage` (platform Admins).
 */
import { asc, eq, inArray, isNotNull, or } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { staffSettings, user } from '@/db/schema';
import { isStaffRoleRaise, wouldLeaveNoAdmin } from '@/lib/authz/guards';
import { PLATFORM_ADMIN_ROLE, type PlatformRole } from '@/lib/authz/roles';
import loadDefaultTimeZone from '@/lib/i18n/default-time-zone';
import type { Locale } from '@/lib/i18n/locales';
import { mayBeAssigned } from '@/lib/requests';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { type PeopleSort, STAFF_TABLE } from '@/lib/tables/tables';
import {
  localeSchema,
  timeZoneSchema,
  requestPrefixSchema,
  staffNameSchema,
  staffRoleSchema,
} from '@/lib/validation';

import {
  assertNotSignedInAs,
  assertConfirmedForGrant,
  assertPermission,
  getGlobalPermissions,
  getStaffPermissionsInCompanies,
} from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import { withMfaPromotion } from '../auth/mfa-promotion';
import { queueSecurityNotice } from '../auth/security-notices';
import type { ServiceContext } from '../context';
import { forbiddenError, notFoundError, ServiceError, parseId } from '../errors';
import { paginate, peopleOrder } from '../pagination';
import { assertRoleChangeLimit } from '../rate-limit';
import { defaultLanguage } from '../recipient-locale';
import { unassignFrom } from '../requests';
import { revokeInvitationsTo, revokeInvitesWithoutManager } from './invitations';
import { loadPictures } from './pictures';
import getRequestPrefix from './request-prefix';
import notifyStaffAdminAdded from './staff-admin-notice';
import getStaffName from './staff-name';

/** A staff member, as shown on the staff page. */
export interface StaffMember {
  /** User ID. */
  userId: string;
  /** Display name (may be empty). */
  name: string;
  /** Email address. */
  email: string;
  /** Their role on the staff. */
  role: PlatformRole;
  /** When they last did something in the app, or `null` if never. */
  lastActiveAt: Date | null;
  /** When their account was created (shown as Joined). */
  createdAt: Date;
  /** When their account was deactivated, or `null` while active. */
  deactivatedAt: Date | null;
  /** Their picture's address (`loadPictures`), or `null` for their initials. */
  picture: string | null;
}

/**
 * Loads the staff's settings for the staff page.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @returns The name, Adiutor's default language (English (US) if the settings row is missing),
 *   its default time zone (UTC if it's missing) and the prefix request numbers are shown with
 *   ("AD" if it's missing).
 */
export async function getStaffSettings(
  ctx: ServiceContext,
  actor: Actor,
): Promise<{
  name: string;
  defaultLocale: Locale;
  defaultTimeZone: string;
  requestPrefix: string;
}> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const [name, defaultLocale, defaultTimeZone, requestPrefix] = await Promise.all([
    getStaffName(ctx.db),
    defaultLanguage(ctx),
    loadDefaultTimeZone(ctx.db),
    getRequestPrefix(ctx.db),
  ]);
  return { name, defaultLocale, defaultTimeZone, requestPrefix };
}

/** A change to the staff's settings: the values to set in the single `staff_settings` row. */
type StaffSettingsChange = Partial<
  Pick<
    typeof staffSettings.$inferInsert,
    'name' | 'defaultLocale' | 'defaultTimeZone' | 'requestPrefix'
  >
>;

/**
 * Saves a change to the staff's settings: locks the settings row
 * (`FOR UPDATE`, so two changes take turns) and updates it. When the row is
 * missing (it was lost), it's created again with the change, and with the
 * name users then see ("Adiutor", `getStaffName`) unless the change is the
 * name.
 *
 * @param tx - The change's transaction.
 * @param change - The values to set.
 * @returns The name before the change, or `null` when there was no row.
 */
async function saveStaffSettings(
  tx: DatabaseTransaction,
  change: StaffSettingsChange,
): Promise<string | null> {
  const [before] = await tx.select({ name: staffSettings.name }).from(staffSettings).for('update');
  if (before) {
    await tx.update(staffSettings).set(change);
  } else {
    await tx
      .insert(staffSettings)
      .values({ name: change.name ?? (await getStaffName(tx)), ...change });
  }
  return before?.name ?? null;
}

/**
 * Sets the prefix request numbers are shown with ("AD" in "AD-142"). Only
 * how numbers look changes: a request keeps its number and its address, and
 * a number written with the earlier prefix still finds it. If the settings
 * row is missing (it was lost), this creates it again, with the name users
 * then see ("Adiutor"). Not a security change, so no audit event, like the
 * default language.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param prefix - The prefix, as the form sent it.
 * @returns The saved prefix, in capitals.
 * @throws {ZodError} When it isn't one to five letters or digits starting with a letter.
 */
export async function setRequestPrefix(
  ctx: ServiceContext,
  actor: Actor,
  prefix: unknown,
): Promise<string> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const requestPrefix = requestPrefixSchema.parse(prefix);
  await ctx.db.transaction((tx) => saveStaffSettings(tx, { requestPrefix }));
  return requestPrefix;
}

/**
 * Sets Adiutor's default language: the language of everyone who hasn't
 * chosen one (no language cookie), and of emails to people without a saved
 * language outside a request. If the settings row is missing (it was lost),
 * this creates it again, with the name users then see ("Adiutor"). Not a
 * security change, so no audit event, like a person's own language.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param locale - The language, as the form sent it.
 * @returns The saved language.
 * @throws {ZodError} When it isn't one of the languages.
 */
export async function setDefaultLocale(
  ctx: ServiceContext,
  actor: Actor,
  locale: unknown,
): Promise<Locale> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const defaultLocale = localeSchema.parse(locale);
  await ctx.db.transaction((tx) => saveStaffSettings(tx, { defaultLocale }));
  return defaultLocale;
}

/**
 * Sets Adiutor's default time zone: the zone of signed-out pages, of people
 * whose zone isn't known yet (before their first visit), and of emails to
 * people without one outside an invitation. Changes nothing for anyone who
 * has a zone. If the settings row is missing (it was lost), this creates it
 * again, with the name users then see ("Adiutor"). Not a security change, so
 * no audit event, like the default language.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param zone - The zone, as the form sent it.
 * @returns The saved zone.
 * @throws {ZodError} When it isn't a zone Adiutor accepts.
 */
export async function setDefaultTimeZone(
  ctx: ServiceContext,
  actor: Actor,
  zone: unknown,
): Promise<string> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const defaultTimeZone = timeZoneSchema.parse(zone);
  await ctx.db.transaction((tx) => saveStaffSettings(tx, { defaultTimeZone }));
  return defaultTimeZone;
}

/**
 * Renames the staff. The name is shown to users and in invitations. If the
 * settings row is missing (it was lost; the app then shows "Adiutor"), this
 * creates it again.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param rawName - The new name.
 */
export async function renameStaff(
  ctx: ServiceContext,
  actor: Actor,
  rawName: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const name = staffNameSchema.parse(rawName);
  await ctx.db.transaction(async (tx) => {
    const from = await saveStaffSettings(tx, { name });
    await recordEvent(
      ctx,
      {
        action: 'staff_renamed',
        actorUserId: actor.id,
        details: { staff: true, from, to: name },
      },
      tx,
    );
  });
}

/**
 * Lists the staff (every user with a platform role), one page at a time.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param options - Sort and page (by default name A to Z, the first page); Joined is when the
 *   account was created.
 * @returns The page of staff members.
 */
export async function listStaff(
  ctx: ServiceContext,
  actor: Actor,
  options: Partial<TableState<PeopleSort>> = {},
): Promise<Paged<StaffMember>> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const state = resolveTableState(STAFF_TABLE, options);
  const where = isNotNull(user.platformRole);
  const page = await paginate(
    state,
    () => ctx.db.$count(user, where),
    (limit, offset) =>
      ctx.db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          role: user.platformRole,
          lastActiveAt: user.lastActiveAt,
          createdAt: user.createdAt,
          deactivatedAt: user.deactivatedAt,
        })
        .from(user)
        .where(where)
        .orderBy(
          ...peopleOrder(state, {
            name: user.name,
            email: user.email,
            lastActiveAt: user.lastActiveAt,
            joined: user.createdAt,
            id: user.id,
          }),
        )
        .limit(limit)
        .offset(offset),
  );
  const pictures = await loadPictures(
    ctx.db,
    page.items.map(({ userId }) => userId),
  );
  return {
    ...page,
    items: page.items.flatMap((row) =>
      row.role ? [{ ...row, role: row.role, picture: pictures.get(row.userId) ?? null }] : [],
    ),
  };
}

/** The audit action per kind of staff role change. */
const STAFF_AUDIT_ACTIONS = {
  granted: 'member_added',
  changed: 'role_changed',
  removed: 'member_removed',
} as const;

/** The security notice per kind of staff role change. */
const STAFF_NOTICES = {
  granted: 'staff_role_granted',
  changed: 'staff_role_changed',
  removed: 'staff_role_removed',
} as const;

/**
 * Sets someone's staff role: makes them staff, changes their role, or takes
 * them off the staff (`null`), refusing anything that would leave the staff
 * without an active Admin. Users may lower their own role but never raise it.
 * Invitations and invite links they sent for staff or companies they can no
 * longer manage are revoked, and taking them off the staff also revokes the
 * open staff invitations addressed to them (`revokeInvitationsTo`), so they
 * can't come back through one, perhaps with a higher role. The person gets a
 * security email once the change has committed. A role change (making
 * someone staff included, not a removal) counts against the actor's limit
 * (`assertRoleChangeLimit`) before the transaction starts.
 *
 * The first statement locks every staff row, the target's and the actor's
 * (`FOR UPDATE`, in ID order, so it takes turns with the last-Admin check of
 * deactivations and deletions, `soleAdminOf`, without deadlocking). Two
 * Admins can't demote each other at once, and the actor's own row, as
 * locked, must still be active and have `staff:manage` (the same rule as
 * when the request started, `getGlobalPermissions`): an actor loaded before
 * a demotion, removal or deactivation that has since committed (a request
 * already under way) is refused. Then come the invite links they created
 * (`revokeInvitesWithoutManager`) and, for a removal, the per-address lock of
 * their address (see "Lock order" in `docs/security-measures.md`).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param userId - The user (unvalidated input is fine).
 * @param newRole - The new role, or `null` to remove them from the staff.
 * @throws {ServiceError} `not_found` for unknown users (or removing someone who
 *   isn't staff), `forbidden` for raising your own role or when the actor, as locked, is
 *   deactivated or no longer has `staff:manage`, `confirmation_required` for making someone
 *   staff or raising their role without a recent confirmation (`assertConfirmedForGrant`),
 *   `conflict` for the last Admin, `rate_limited` past the actor's role changes.
 */
async function setStaffRole(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  newRole: PlatformRole | null,
): Promise<void> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const id = parseId(userId);
  // Each change emails the person: limited, so it can't be repeated to flood their inbox.
  if (newRole !== null) {
    await assertRoleChangeLimit(ctx, actor.id);
  }

  const change = await ctx.db.transaction(async (tx) => {
    // One statement, in ID order: the staff (for the Admin count), the target and the actor.
    const rows = await tx
      .select({
        id: user.id,
        email: user.email,
        role: user.platformRole,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(or(isNotNull(user.platformRole), inArray(user.id, [id, actor.id])))
      .orderBy(asc(user.id))
      .for('update');
    const target = rows.find((row) => row.id === id);
    if (!target || (target.role === null && newRole === null)) {
      throw notFoundError();
    }
    if (target.role === newRole) {
      return null;
    }
    // Nobody raises their own staff role, even with rights from before a demotion they missed.
    if (target.id === actor.id && isStaffRoleRaise(target.role, newRole)) {
      throw new ServiceError('forbidden', 'errors.staff.selfRaise');
    }
    // Making someone staff, or raising their role, needs a recent confirmation (stepping down doesn't).
    if (newRole !== null) {
      assertConfirmedForGrant(actor, {
        target: { type: 'staff' },
        role: newRole,
        from: target.role,
      });
    }
    // The rights the actor was loaded with may be gone by now: only their row as locked counts,
    // checked with the same rule as when the request started.
    const self = rows.find((row) => row.id === actor.id);
    if (!self || self.deactivatedAt !== null) {
      throw forbiddenError();
    }
    assertPermission(getGlobalPermissions({ platformRole: self.role }), 'staff:manage');

    const adminCount = rows.filter(
      (row) => row.role === PLATFORM_ADMIN_ROLE && row.deactivatedAt === null,
    ).length;
    if (
      target.role !== null &&
      target.deactivatedAt === null &&
      wouldLeaveNoAdmin({
        adminRole: PLATFORM_ADMIN_ROLE,
        adminCount,
        currentRole: target.role,
        newRole,
      })
    ) {
      throw new ServiceError('conflict', 'errors.staff.lastAdmin');
    }

    let kind: keyof typeof STAFF_NOTICES = 'changed';
    if (target.role === null) {
      kind = 'granted';
    } else if (newRole === null) {
      kind = 'removed';
    }
    // Made a Manager or Admin: their sessions without MFA that counts for that end.
    await withMfaPromotion(ctx, tx, [target.id], async () => {
      await tx.update(user).set({ platformRole: newRole }).where(eq(user.id, target.id));
      // Invitations and links they sent for staff or companies they can no longer manage stop working.
      await revokeInvitesWithoutManager(ctx, tx, target.id);
      // Off the staff, an open staff invitation to them would let them back in. After the links
      // above: invite links come before the per-address locks.
      if (newRole === null) {
        await revokeInvitationsTo(ctx, tx, target.email, { companyId: null });
      }
      // Without request work they're taken off the requests they're on: after the invitations,
      // since requests come last in the lock order.
      if (!mayBeAssigned(getStaffPermissionsInCompanies({ platformRole: newRole }))) {
        await unassignFrom(tx, target.id);
      }
      await recordEvent(
        ctx,
        {
          action: STAFF_AUDIT_ACTIONS[kind],
          actorUserId: actor.id,
          targetUserId: target.id,
          details: { staff: true, from: target.role, to: newRole, role: newRole ?? target.role },
        },
        tx,
      );
    });
    return {
      kind,
      becameAdmin: newRole === PLATFORM_ADMIN_ROLE && target.role !== PLATFORM_ADMIN_ROLE,
    };
  });

  if (change) {
    await queueSecurityNotice(ctx.db, id, STAFF_NOTICES[change.kind], { role: newRole });
    // The other staff Admins hear about a new one (not the actor, who made the change).
    if (change.becameAdmin) {
      await notifyStaffAdminAdded(ctx, { newAdminId: id, how: 'role', byUserId: actor.id });
    }
  }
}

/**
 * Gives someone a staff role: makes them staff, or changes their role.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - Form input.
 * @param input.userId - The user.
 * @param input.role - The staff role (`staffRoleSchema`).
 * @throws {ZodError} For a role that isn't a staff role.
 * @throws {ServiceError} `conflict` for the last Admin, `rate_limited` past the actor's role
 *   changes (`assertRoleChangeLimit`).
 */
export async function changeStaffRole(
  ctx: ServiceContext,
  actor: Actor,
  input: { userId: string; role: string },
): Promise<void> {
  assertNotSignedInAs(actor);
  const role = staffRoleSchema.parse(input.role);
  await setStaffRole(ctx, actor, input.userId, role);
}

/**
 * Takes someone off the staff. Their account stays, with any company
 * memberships.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param userId - The staff member.
 * @throws {ServiceError} `conflict` for the last Admin.
 */
export async function removeFromStaff(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  assertNotSignedInAs(actor);
  await setStaffRole(ctx, actor, userId, null);
}
