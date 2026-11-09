/**
 * @file User administration: the user detail page (and whether its user
 * exists, for its title), and what Admins can do to
 * an account (reset two-step verification, which also disconnects GitHub and
 * Google accounts, sign out everywhere, deactivate, reactivate, delete), plus
 * deactivating your own account.
 *
 * Every change is recorded in the audit log, emails the user, and refuses
 * anything that would leave a company or the staff without an Admin who can
 * sign in, also when two such changes come at the same moment
 * (`soleAdminOf` locks before it counts).
 */
import { verifyPassword } from 'better-auth/crypto';
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database, DatabaseOrTransaction } from '@/db';
import { account, company, membership, passkey, session, twoFactor, user } from '@/db/schema';
import {
  isSessionMfaVerified,
  type MfaRole,
  type MfaState,
  type MfaStatus,
  mfaStatus,
  needsFreshSignIn,
  needsRecentConfirmation,
  requiresMfa,
} from '@/lib/authz/mfa';
import {
  COMPANY_ADMIN_ROLE,
  type CompanyRole,
  PLATFORM_ADMIN_ROLE,
  type PlatformRole,
} from '@/lib/authz/roles';
import { OAUTH_PROVIDERS } from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';
import { MFA_VERIFICATION_REQUIRED, SESSION_NOT_FRESH } from '@/lib/sign-in/sign-in-refusals';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import {
  DEVICES_TABLE,
  type DeviceSort,
  USER_COMPANIES_TABLE,
  type UserCompanySort,
} from '@/lib/tables/tables';
import { idSchema } from '@/lib/validation';

import { assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { type AuditEntry, listAuditEvents, recordEvent } from '../audit';
import { hasOtherActiveAdmin } from './staff';
import { listConnectedProviders } from '../auth/accounts';
import { checkCurrentPassword } from '../auth/current-password';
import { loadMfaContext } from '../auth/mfa-state';
import { sendSecurityNotice } from '../auth/security-notices';
import { endSessionsOf } from '../auth/sessions';
import { withSignInChangeLock } from '../auth/sign-in-change-lock';
import type { ServiceContext } from '../context';
import { concurrentChangeError, notFoundError, ServiceError, parseId } from '../errors';
import { revokeInvitationsTo, revokeInvitesWithoutManager } from './invitations';
import { orderTerms, paginate, textOrder } from '../pagination';

/** A company the user belongs to, on the detail page. */
export interface UserCompany {
  /** Company ID. */
  id: string;
  /** The membership's ID, for changing the role or removing them. */
  membershipId: string;
  /** Company name. */
  name: string;
  /** The company's URL name, which links to it use. */
  slug: string;
  /** Their role there. */
  role: CompanyRole;
  /** When they joined. */
  joinedAt: Date;
  /** Whether the company is deactivated. */
  deactivated: boolean;
}

/** A signed-in device, on the detail page and the Security page. */
export interface UserSession {
  /** Session ID. */
  id: string;
  /** The browser's user agent, if known. */
  userAgent: string | null;
  /** IP address it signed in from, if known. */
  ipAddress: string | null;
  /** When it signed in. */
  createdAt: Date;
  /**
   * When the session row last changed, e.g. when a second step was confirmed
   * (sessions aren't extended while used: `disableSessionRefresh` in
   * `src/lib/auth.ts`).
   */
  updatedAt: Date;
  /** When it expires. */
  expiresAt: Date;
  /** Whether its sign-in was MFA verified (shown as "MFA Verified"). */
  mfaVerified: boolean;
}

/** Everything the user detail page shows. */
export interface UserDetail {
  /** User ID. */
  id: string;
  /** Their staff role, or `null` if they aren't on it. */
  staffRole: PlatformRole | null;
  /** Display name (may be empty). */
  name: string;
  /** Email address. */
  email: string;
  /** Whether the email address is verified. */
  emailVerified: boolean;
  /** When the account was created. */
  createdAt: Date;
  /** When they last did something in the app, or `null` if never. */
  lastActiveAt: Date | null;
  /** When the account was deactivated, or `null` while active. */
  deactivatedAt: Date | null;
  /** Their sign-in setup. */
  mfa: MfaState & {
    /** How they stand with the MFA rules. */
    status: MfaStatus;
    /** Whether their role requires MFA. */
    required: boolean;
  };
  /**
   * How many GitHub or Google accounts are connected to theirs, confirmed or
   * not (`mfa.providerAccounts` leaves out the unconfirmed ones). An Admin's
   * MFA reset disconnects them all ({@link resetUserMfa}).
   */
  connectedAccounts: number;
  /** A page of their companies (by default by name). */
  companies: Paged<UserCompany>;
  /**
   * A page of their signed-in devices (by default most recent first), or
   * `null` without `users:manage` (IP addresses and devices are for Admins only).
   */
  sessions: Paged<UserSession> | null;
  /** Their recent audit log entries, or `null` without `audit:view`. */
  activity: AuditEntry[] | null;
  /**
   * The names of their provider accounts at the providers (a GitHub username,
   * a Google email address), by account ID, or `null` without `users:manage`
   * (Admins only). A name is `null` while it isn't known yet.
   */
  accountNames: Record<string, string | null> | null;
}

/** A session row as stored, before it's judged against the MFA rules (see {@link asSeenWith}). */
type StoredSession = Omit<UserSession, 'mfaVerified'> & {
  /** Whether a second step was recorded for it. */
  mfaVerified: boolean | null;
  /** How that second step was taken, if recorded. */
  mfaMethod: string | null;
};

/**
 * Loads a page of a user's sessions that haven't expired, as stored.
 *
 * @param db - Database client.
 * @param userId - The user.
 * @param options - Sort and page (by default most recently signed in first, the first page).
 * @returns The page of sessions.
 */
async function loadSessionRows(
  db: Database,
  userId: string,
  options: Partial<TableState<DeviceSort>>,
): Promise<Paged<StoredSession>> {
  const state = resolveTableState(DEVICES_TABLE, options);
  const where = and(eq(session.userId, userId), gt(session.expiresAt, sql`now()`));
  return paginate(
    state,
    () => db.$count(session, where),
    (limit, offset) =>
      db
        .select({
          id: session.id,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
          mfaVerified: session.mfaVerified,
          mfaMethod: session.mfaMethod,
        })
        .from(session)
        .where(where)
        .orderBy(...orderTerms(state.dir, session.createdAt, session.id))
        .limit(limit)
        .offset(offset),
  );
}

/**
 * Decides which sessions count as MFA verified for the user's MFA role now
 * (e.g. an email code doesn't count for a company Admin, but does once
 * they're a Client again).
 *
 * @param rows - The page of sessions as stored.
 * @param mfaRole - The user's MFA role, read in this request.
 * @returns The page as the user detail and Security pages show it.
 */
function asSeenWith(rows: Paged<StoredSession>, mfaRole: MfaRole | null): Paged<UserSession> {
  return {
    ...rows,
    items: rows.items.map(({ mfaMethod, ...row }) => ({
      ...row,
      mfaVerified: isSessionMfaVerified(
        { mfaVerified: row.mfaVerified ?? false, mfaMethod },
        mfaRole,
      ),
    })),
  };
}

/**
 * Lists a user's signed-in devices (their sessions that haven't expired),
 * one page at a time. Callers check who may see them, and pass the user's
 * MFA role, which decides which sessions count as MFA verified: read in the
 * same request (e.g. `actor.mfaRole` for the signed-in user).
 *
 * @param db - Database client.
 * @param userId - The user.
 * @param mfaRole - The user's MFA role now (see `mfaRoleOf`).
 * @param options - Sort and page (by default most recently signed in first, the first page).
 * @returns The page of sessions.
 */
export async function listUserSessions(
  db: Database,
  userId: string,
  mfaRole: MfaRole | null,
  options: Partial<TableState<DeviceSort>> = {},
): Promise<Paged<UserSession>> {
  return asSeenWith(await loadSessionRows(db, userId, options), mfaRole);
}

/**
 * Loads the names of a user's provider accounts at the providers, by account
 * ID (for staff Admins, see {@link UserDetail.accountNames}).
 *
 * @param db - Database client.
 * @param userId - The user.
 * @returns Each provider account's name, or `null` while it isn't known.
 */
async function loadAccountNames(
  db: Database,
  userId: string,
): Promise<Record<string, string | null>> {
  const accounts = await listConnectedProviders(db, userId);
  return Object.fromEntries(accounts.map(({ id, accountName }) => [id, accountName]));
}

/** The tables of the user detail page, for {@link getUserDetail}. */
export interface UserDetailOptions {
  /** Sort and page of their companies. */
  companies?: Partial<TableState<UserCompanySort>>;
  /** Sort and page of their signed-in devices. */
  sessions?: Partial<TableState<DeviceSort>>;
}

/**
 * Loads a user for the detail page. Staff only (`users:view`).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:view`.
 * @param userId - The user (unvalidated input is fine).
 * @param options - Sort and page of the page's tables.
 * @returns The user's details.
 * @throws {ServiceError} `forbidden` for non-staff, `not_found` for unknown users.
 */
export async function getUserDetail(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  options: UserDetailOptions = {},
): Promise<UserDetail> {
  const permissions = getGlobalPermissions(actor);
  assertPermission(permissions, 'users:view');
  const id = parseId(userId);

  const [found] = await ctx.db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
      deactivatedAt: user.deactivatedAt,
      staffRole: user.platformRole,
    })
    .from(user)
    .where(eq(user.id, id));
  if (!found) {
    throw notFoundError();
  }
  const staffRole = found.staffRole ?? null;

  const companiesState = resolveTableState(USER_COMPANIES_TABLE, options.companies);
  const ofUser = eq(membership.userId, id);
  const companyOrder =
    companiesState.sort === 'joined'
      ? orderTerms(companiesState.dir, membership.createdAt, membership.id)
      : orderTerms(companiesState.dir, textOrder(company.name), company.id);
  const [mfa, connectedAccounts, companies, sessions, activity, accountNames] = await Promise.all([
    // The MFA role comes from all their memberships, not just the page of companies shown.
    loadMfaContext(ctx.db, id),
    ctx.db.$count(
      account,
      and(eq(account.userId, id), inArray(account.providerId, [...OAUTH_PROVIDERS])),
    ),
    paginate(
      companiesState,
      () => ctx.db.$count(membership, ofUser),
      (limit, offset) =>
        ctx.db
          .select({
            id: company.id,
            membershipId: membership.id,
            name: company.name,
            slug: company.slug,
            role: membership.role,
            joinedAt: membership.createdAt,
            deactivatedAt: company.deactivatedAt,
          })
          .from(membership)
          .innerJoin(company, eq(company.id, membership.companyId))
          .where(ofUser)
          .orderBy(...companyOrder)
          .limit(limit)
          .offset(offset),
    ),
    // Judged once the MFA role above is in (`asSeenWith`), so both load in this one batch.
    permissions.has('users:manage') ? loadSessionRows(ctx.db, id, options.sessions ?? {}) : null,
    permissions.has('audit:view') ? listAuditEvents(ctx, actor, { userId: id }, 25) : null,
    permissions.has('users:manage') ? loadAccountNames(ctx.db, id) : null,
  ]);
  if (!mfa) {
    throw notFoundError();
  }
  const { state, mfaRole } = mfa;

  return {
    ...found,
    staffRole,
    mfa: {
      ...state,
      status: mfaStatus(state, mfaRole, availableProviders),
      required: requiresMfa(mfaRole),
    },
    connectedAccounts,
    companies: {
      ...companies,
      items: companies.items.map(({ deactivatedAt, ...row }) => ({
        ...row,
        deactivated: Boolean(deactivatedAt),
      })),
    },
    sessions: sessions && asSeenWith(sessions, mfaRole),
    activity,
    accountNames,
  };
}

/**
 * Whether a user account exists (deactivated or not), for the title of their
 * detail page, which is "Not found · Adiutor" when it doesn't. Staff only
 * (`users:view`), checked before the lookup like {@link getUserDetail}.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:view`.
 * @param userId - The user (unvalidated input is fine).
 * @returns Whether they exist; `false` for something that isn't an ID.
 * @throws {ServiceError} `forbidden` for non-staff.
 */
export async function userExists(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<boolean> {
  assertPermission(getGlobalPermissions(actor), 'users:view');
  const id = idSchema.safeParse(userId);
  if (!id.success) {
    return false;
  }
  const [found] = await ctx.db.select({ id: user.id }).from(user).where(eq(user.id, id.data));
  return Boolean(found);
}

/** What a user is the last Admin of who can still sign in. */
export interface SoleAdminOf {
  /** Whether they're the last active staff Admin. */
  staff: boolean;
  /** Active companies they're the last Admin of, by name. */
  companies: string[];
}

/** The rows {@link lockSoleAdminRows} locked. */
interface SoleAdminLocks {
  /** The companies whose rows it locked: every company the user was an Admin of. */
  companyIds: Set<string>;
  /** Whether it locked the other active staff Admins' rows too. */
  staffAdmins: boolean;
  /** The user's staff role, as locked. */
  platformRole: PlatformRole | null;
}

/**
 * Takes the locks {@link soleAdminOf} relies on, in the order every
 * transaction takes them (see "Lock order" in `docs/security-measures.md`):
 *
 * 1. the rows of the companies the user is an Admin of (`FOR NO KEY UPDATE`,
 *    in ID order), active or not: changing a company's members
 *    (`changeMembership`), deactivating or deleting another of its Admins and
 *    (de)activating the company all take that row first, so they take turns
 *    with this; inserts that only point at the company (memberships,
 *    invitations, audit events) don't wait for it;
 * 2. the user's row, plus the other active staff Admins' rows when the user
 *    is a staff Admin (`FOR UPDATE`, in ID order, in one statement, like
 *    `setStaffRole`). Locking the user's row also makes invitations and
 *    invite links they create at that moment (their insert locks the row as
 *    its creator) wait until the change has committed, so a deletion's
 *    revoke sees them, or their insert fails once the account is gone.
 *
 * @param tx - Transaction.
 * @param userId - The user.
 * @returns What it locked.
 * @throws {ServiceError} `not_found` when the user is gone.
 */
async function lockSoleAdminRows(
  tx: DatabaseOrTransaction,
  userId: string,
): Promise<SoleAdminLocks> {
  const adminOf = await tx
    .select({ id: membership.companyId })
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.role, COMPANY_ADMIN_ROLE)));
  const companyIds = new Set(adminOf.map((row) => row.id));
  if (companyIds.size > 0) {
    await tx
      .select({ id: company.id })
      .from(company)
      .where(inArray(company.id, [...companyIds]))
      .orderBy(asc(company.id))
      .for('no key update');
  }

  const [before] = await tx
    .select({ platformRole: user.platformRole })
    .from(user)
    .where(eq(user.id, userId));
  const staffAdmins = before?.platformRole === PLATFORM_ADMIN_ROLE;
  const locked = await tx
    .select({ id: user.id, platformRole: user.platformRole })
    .from(user)
    .where(
      staffAdmins
        ? or(
            eq(user.id, userId),
            and(eq(user.platformRole, PLATFORM_ADMIN_ROLE), isNull(user.deactivatedAt)),
          )
        : eq(user.id, userId),
    )
    .orderBy(asc(user.id))
    .for('update');
  const self = locked.find((row) => row.id === userId);
  if (!self) {
    throw notFoundError();
  }
  return { companyIds, staffAdmins, platformRole: self.platformRole ?? null };
}

/**
 * Finds what a user is the only Admin of who can still sign in: the staff and
 * active companies.
 *
 * With `lock` (the default, in the change's transaction), it first locks the
 * rows the answer depends on ({@link lockSoleAdminRows}: the user's Admin
 * companies, then the user and, for a staff Admin, the other staff Admins),
 * and only then counts the other active Admins, in new statements, which at
 * READ COMMITTED see everything committed before the locks were granted. So
 * two changes that could each take away the last Admin (deactivating,
 * deleting, demoting or removing two Admins at once) take turns, and the
 * second one sees the first. If the user became an Admin of something the
 * locks don't cover while they were being taken, it refuses with a conflict
 * rather than answer from rows it doesn't hold.
 *
 * @param db - Database client or transaction.
 * @param userId - The user.
 * @param options - How to read.
 * @param options.lock - Lock first; on by default. Off only for a read that decides nothing by
 *   itself, such as a page or a check the change's transaction repeats with locks
 *   (`deactivateOwnAccount`).
 * @returns What they're the last Admin of.
 * @throws {ServiceError} With `lock`: `not_found` when the user is gone, `conflict`
 *   ({@link concurrentChangeError}) when they became an Admin meanwhile.
 */
export async function soleAdminOf(
  db: DatabaseOrTransaction,
  userId: string,
  { lock = true }: { lock?: boolean } = {},
): Promise<SoleAdminOf> {
  const locks = lock ? await lockSoleAdminRows(db, userId) : null;
  let platformRole: PlatformRole | null;
  if (locks) {
    // Promoted to staff Admin while the locks were taken: the other staff Admins aren't locked.
    if (locks.platformRole === PLATFORM_ADMIN_ROLE && !locks.staffAdmins) {
      throw concurrentChangeError();
    }
    ({ platformRole } = locks);
  } else {
    const [found] = await db
      .select({ platformRole: user.platformRole })
      .from(user)
      .where(eq(user.id, userId));
    platformRole = found?.platformRole ?? null;
  }
  // From here on, new statements: they see what was committed before the locks were granted.
  const lastStaffAdmin =
    platformRole === PLATFORM_ADMIN_ROLE && !(await hasOtherActiveAdmin({ db }, userId));

  const adminOf = await db
    .select({ id: company.id, name: company.name })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(
      and(
        eq(membership.userId, userId),
        eq(membership.role, COMPANY_ADMIN_ROLE),
        isNull(company.deactivatedAt),
      ),
    );
  // Made an Admin of another company while the locks were taken: that company isn't locked.
  const lockedCompanies = locks?.companyIds;
  if (lockedCompanies && adminOf.some((row) => !lockedCompanies.has(row.id))) {
    throw concurrentChangeError();
  }
  // The other active Admins of those companies, one row per Admin.
  const otherAdmins =
    adminOf.length > 0
      ? await db
          .select({ companyId: membership.companyId })
          .from(membership)
          .innerJoin(user, eq(user.id, membership.userId))
          .where(
            and(
              inArray(
                membership.companyId,
                adminOf.map(({ id }) => id),
              ),
              eq(membership.role, COMPANY_ADMIN_ROLE),
              ne(membership.userId, userId),
              isNull(user.deactivatedAt),
            ),
          )
      : [];

  return {
    staff: lastStaffAdmin,
    companies: adminOf
      .filter((row) => !otherAdmins.some((other) => other.companyId === row.id))
      .map((row) => row.name),
  };
}

/**
 * Explains why someone can't lose access, e.g. "You're the only staff Admin
 * and the only Admin of Adiutor Tests Alpha."
 *
 * @param subject - How to refer to them, e.g. "You're" or "This user is".
 * @param sole - What they're the last Admin of.
 * @returns The explanation, or `null` when nothing would be left without an Admin.
 */
export function describeSoleAdmin(subject: string, sole: SoleAdminOf): string | null {
  const parts = [
    ...(sole.staff ? ['the only staff Admin'] : []),
    ...(sole.companies.length > 0 ? [`the only Admin of ${sole.companies.join(', ')}`] : []),
  ];
  return parts.length > 0 ? `${subject} ${parts.join(' and ')}.` : null;
}

/**
 * Refuses a change that would leave the staff or companies without an Admin
 * who can sign in. With `lock`, it's the change's first locking step: it
 * locks the user's Admin companies, the user's row and, for a staff Admin,
 * the other staff Admins' rows ({@link soleAdminOf}).
 *
 * @param db - Database client or transaction.
 * @param userId - The user who'd lose access.
 * @param subject - How to refer to them, e.g. "You are" or "This user is".
 * @param options - How to read (see {@link soleAdminOf}).
 * @param options.lock - Lock first; on by default.
 * @throws {ServiceError} `conflict` naming the companies (or asking to try again when something
 *   changed while the locks were taken), `not_found` when the user is gone.
 */
async function assertNotSoleAdmin(
  db: DatabaseOrTransaction,
  userId: string,
  subject: string,
  options: { lock?: boolean } = {},
): Promise<void> {
  const reason = describeSoleAdmin(subject, await soleAdminOf(db, userId, options));
  if (reason) {
    throw new ServiceError('conflict', `${reason} Make someone else an Admin first.`);
  }
}

/**
 * Reads the ID of the user an Admin action is about, refusing actions on
 * yourself (use your Security page instead, with its own checks).
 *
 * @param actor - The acting user.
 * @param userId - The target (unvalidated input is fine).
 * @returns The target's ID.
 * @throws {ServiceError} `not_found` for anything that isn't an ID, `invalid` for yourself.
 */
function targetIdOf(actor: Actor, userId: string): string {
  const id = parseId(userId);
  if (id === actor.id) {
    throw new ServiceError('invalid', 'Use your Security page to change your own account.');
  }
  return id;
}

/**
 * Loads the user an Admin action is about, refusing actions on yourself
 * ({@link targetIdOf}). Only for account actions: company memberships and the
 * staff role don't use it.
 *
 * @param db - Database client or transaction.
 * @param actor - The acting user.
 * @param userId - The target (unvalidated input is fine).
 * @returns The target's ID, email and deactivation.
 * @throws {ServiceError} `not_found` or `invalid` for yourself.
 */
async function loadTarget(db: DatabaseOrTransaction, actor: Actor, userId: string) {
  const id = targetIdOf(actor, userId);
  const [target] = await db
    .select({ id: user.id, email: user.email, name: user.name, deactivatedAt: user.deactivatedAt })
    .from(user)
    .where(eq(user.id, id));
  if (!target) {
    throw notFoundError();
  }
  return target;
}

/**
 * Turns off a user's two-step verification (for a lost phone), optionally
 * removing their passkeys too, and disconnects their GitHub and Google
 * accounts, confirmed or not: one connected by someone who once verified the
 * user's address at the provider may be the account's only second step, which
 * nothing else could remove (see "Automatic linking" in
 * `docs/authentication.md`). It also signs them out everywhere (a lost phone
 * may still be signed in) and forgets their trusted devices. Their next
 * sign-in is with their password, a passkey they kept or an email link, and
 * if their role requires MFA they're asked to set it up again. The audit
 * event names the providers whose accounts were disconnected, and the user
 * gets a security email.
 *
 * In this order:
 *
 * 1. The Admin needs `users:manage`, and a confirmation with their own second
 *    step from the last 15 minutes (`needsRecentConfirmation`), as for
 *    changing how they sign in themselves.
 * 2. Not on yourself (use your Security page).
 * 3. The reset holds the user's sign-in change lock (`withSignInChangeLock`),
 *    so it can't cross a change they're making at that moment, such as
 *    connecting a provider account.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 * @param options - What to reset.
 * @param options.removePasskeys - Also remove all their passkeys.
 * @throws {ServiceError} `forbidden` without `users:manage` or a recent confirmation
 *   (`MFA_VERIFICATION_REQUIRED`'s message), `invalid` on yourself, `not_found` for unknown users,
 *   `conflict` while another change to how the user signs in is being made.
 */
export async function resetUserMfa(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  { removePasskeys = false }: { removePasskeys?: boolean } = {},
): Promise<void> {
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('forbidden', MFA_VERIFICATION_REQUIRED.message);
  }
  const targetId = targetIdOf(actor, userId);
  const { email } = await withSignInChangeLock(ctx, targetId, () =>
    ctx.db.transaction(async (tx) => {
      const target = await loadTarget(tx, actor, targetId);
      await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, target.id));
      await tx.delete(twoFactor).where(eq(twoFactor.userId, target.id));
      if (removePasskeys) {
        await tx.delete(passkey).where(eq(passkey.userId, target.id));
      }
      const disconnected = await tx
        .delete(account)
        .where(
          and(eq(account.userId, target.id), inArray(account.providerId, [...OAUTH_PROVIDERS])),
        )
        .returning({ providerId: account.providerId });
      await endSessionsOf(tx, target.id);
      await recordEvent(
        ctx,
        {
          action: 'mfa_reset',
          actorUserId: actor.id,
          targetUserId: target.id,
          // Which providers, never which accounts (their names are personal data).
          details: {
            removePasskeys,
            disconnectedProviders: [...new Set(disconnected.map((row) => row.providerId))].sort(),
          },
        },
        tx,
      );
      return { email: target.email };
    }),
  );
  await sendSecurityNotice(ctx, { email }, 'mfa_reset');
}

/**
 * Signs a user out on every device, and forgets their trusted devices.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 */
export async function signOutUserEverywhere(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  const { email } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId);
    // Trusted devices too: a stolen device that was trusted mustn't skip the code step at its next
    // sign-in.
    await endSessionsOf(tx, target.id);
    await recordEvent(
      ctx,
      {
        action: 'sessions_revoked',
        actorUserId: actor.id,
        targetUserId: target.id,
        details: { byAdmin: true },
      },
      tx,
    );
    return { email: target.email };
  });
  await sendSecurityNotice(ctx, { email }, 'signed_out_everywhere');
}

/**
 * Deactivates an account: signs it out everywhere and forgets its trusted
 * devices (so a stolen browser that was trusted can't skip the code step
 * after a reactivation), revokes the invitations and invite links it sent,
 * and refuses new sign-ins until an Admin reactivates it. Call it after the locking last-Admin check
 * (`assertNotSoleAdmin`), which has locked the account's row.
 *
 * @param ctx - Service context (for the audit log).
 * @param db - Transaction.
 * @param userId - The user.
 */
async function deactivate(
  ctx: ServiceContext,
  db: DatabaseOrTransaction,
  userId: string,
): Promise<void> {
  await db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, userId));
  await endSessionsOf(db, userId);
  await revokeInvitesWithoutManager(ctx, db, userId, { all: true });
}

/**
 * Deactivates someone else's account.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 * @throws {ServiceError} `conflict` when already deactivated or the last Admin of a company.
 */
export async function deactivateUser(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  const { email } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId);
    if (target.deactivatedAt) {
      throw new ServiceError('conflict', 'This account is already deactivated.');
    }
    await assertNotSoleAdmin(tx, target.id, 'This user is');
    await deactivate(ctx, tx, target.id);
    await recordEvent(
      ctx,
      { action: 'account_deactivated', actorUserId: actor.id, targetUserId: target.id },
      tx,
    );
    return { email: target.email };
  });
  await sendSecurityNotice(ctx, { email }, 'account_deactivated');
}

/**
 * Reactivates a deactivated account, so it can sign in again.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user.
 * @throws {ServiceError} `conflict` when the account is active.
 */
export async function reactivateUser(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  const { email } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId);
    if (!target.deactivatedAt) {
      throw new ServiceError('conflict', 'This account is already active.');
    }
    await tx.update(user).set({ deactivatedAt: null }).where(eq(user.id, target.id));
    await recordEvent(
      ctx,
      { action: 'account_reactivated', actorUserId: actor.id, targetUserId: target.id },
      tx,
    );
    return { email: target.email };
  });
  await sendSecurityNotice(ctx, { email }, 'account_reactivated');
}

/**
 * Deletes a user account permanently, with their memberships, sign-in
 * methods and sessions. Open invitations and links they sent are revoked
 * first (used ones stay in the history, without an inviter), and so are the
 * open invitations addressed to them, to any company or the staff
 * (`revokeInvitationsTo`): otherwise one could create a new account for the
 * address and join with it. Once the deletion has committed, the address the
 * account had (read in the transaction, with its row locked) gets an
 * `account_deleted` security email, without the Admin's device or IP address.
 *
 * The last-Admin check locks the user's row (`FOR UPDATE`) before the
 * revoke, and the row stays locked until the account is gone: an invitation
 * or invite link they create at that moment waits for it (its insert locks
 * the row as its creator), so it either committed before and is revoked, or
 * fails once the account is gone. A link of theirs claimed at that moment
 * leaves no open invitation either (see `revokeInvitesWithoutManager`). The
 * invitations addressed to them are revoked last, under their per-address
 * locks (after invite links, as the lock order wants).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:delete`.
 * @param userId - The user.
 * @param confirmEmail - The user's email address, typed to confirm.
 * @throws {ServiceError} `invalid` when the email doesn't match, `conflict`
 *   when they're the last Admin of a company.
 */
export async function deleteUser(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  confirmEmail: string,
): Promise<void> {
  assertPermission(getGlobalPermissions(actor), 'users:delete');
  const { email, locale } = await ctx.db.transaction(async (tx) => {
    const target = await loadTarget(tx, actor, userId);
    if (confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
      throw new ServiceError('invalid', 'Type the email address exactly to confirm.');
    }
    // Locks their row first, so nothing they create meanwhile escapes the revoke below.
    await assertNotSoleAdmin(tx, target.id, 'This user is');
    // Their address as it is now that the row is locked (a new statement): it can't change
    // before the deletion commits, and the security email goes to it, in their language.
    const [locked] = await tx
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(eq(user.id, target.id));
    if (!locked) {
      throw notFoundError();
    }
    // Their invitations would otherwise keep working without an inviter.
    await revokeInvitesWithoutManager(ctx, tx, target.id, { all: true });
    // And those addressed to them would let a new account for the address join.
    await revokeInvitationsTo(ctx, tx, locked.email, 'all');
    await recordEvent(
      ctx,
      {
        action: 'account_deleted',
        actorUserId: actor.id,
        targetUserId: null,
        details: { email: locked.email, name: target.name },
      },
      tx,
    );
    await tx.delete(user).where(eq(user.id, target.id));
    return { email: locked.email, locale: locked.locale };
  });
  // Only once the deletion has committed: a refused one sends nothing. The account is gone, so its
  // language comes along.
  await sendSecurityNotice(ctx, { email }, 'account_deleted', { locale });
}

/**
 * Deactivates the signed-in user's own account. Only an Admin can
 * reactivate it. In this order:
 *
 * 1. An account with a second step needs a confirmation with it from the
 *    last 15 minutes (`needsRecentConfirmation`), as for changing how it
 *    signs in.
 * 2. Someone who's the last Admin of the staff or an active company is
 *    refused before their password is checked, so the refusal is the same
 *    with a right or a wrong one: a session can't use it to test passwords.
 * 3. With a password, it must be typed (`checkCurrentPassword`: wrong ones
 *    are limited per user and recorded). Without a password or a second
 *    step, the session must have signed in within the last hour
 *    (`needsFreshSignIn`), so an old (stolen) session can't do it alone.
 * 4. The change's transaction repeats the last-Admin check with locks, then
 *    deactivates the account.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param password - Their current password, required when they have one.
 * @throws {ServiceError} `forbidden` without a recent confirmation (`MFA_VERIFICATION_REQUIRED`'s
 *   message) or a fresh sign-in (`SESSION_NOT_FRESH`'s), `conflict` when they're the last Admin
 *   of the staff or a company, `invalid` for a wrong password, `rate_limited` after too many.
 */
export async function deactivateOwnAccount(
  ctx: ServiceContext,
  actor: Actor,
  password: string,
): Promise<void> {
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('forbidden', MFA_VERIFICATION_REQUIRED.message);
  }
  // Without locks: it only answers early, and the transaction below checks again with them.
  await assertNotSoleAdmin(ctx.db, actor.id, 'You are', { lock: false });
  const [credential] = await ctx.db
    .select({ password: account.password })
    .from(account)
    .where(
      and(
        eq(account.userId, actor.id),
        eq(account.providerId, 'credential'),
        isNotNull(account.password),
      ),
    );
  const hash = credential?.password;
  if (hash) {
    // Outside the transaction, so a wrong password's attempt and audit event are kept.
    await checkCurrentPassword(ctx, actor, 'deactivate', () => verifyPassword({ hash, password }));
  } else if (needsFreshSignIn(actor)) {
    // No password and no second step (with one, the confirmation above was needed).
    throw new ServiceError('forbidden', SESSION_NOT_FRESH.message);
  }
  await ctx.db.transaction(async (tx) => {
    await assertNotSoleAdmin(tx, actor.id, 'You are');
    await deactivate(ctx, tx, actor.id);
    await recordEvent(
      ctx,
      {
        action: 'account_deactivated',
        actorUserId: actor.id,
        targetUserId: actor.id,
        details: { self: true },
      },
      tx,
    );
  });
  // Their own change, so the email may say from which device.
  await sendSecurityNotice(ctx, { email: actor.email }, 'account_deactivated', {
    showDevice: true,
  });
}
