/**
 * @file The last-Admin rule: what a user is the only Admin of who can still
 * sign in (`soleAdminOf`, which locks the rows it depends on first, so two
 * changes at the same moment take turns), the refusal that goes with it
 * (`soleAdminError`) and the check the changes use (`assertNotSoleAdmin`).
 */
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { company, membership, user } from '@/db/schema';
import { COMPANY_ADMIN_ROLE, PLATFORM_ADMIN_ROLE, type PlatformRole } from '@/lib/authz/roles';

import { concurrentChangeError, notFoundError, ServiceError } from '../../errors';

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
  return { companyIds, staffAdmins, platformRole: self.platformRole };
}

/**
 * Checks whether the staff has another active Admin than this user. It only
 * reads: {@link soleAdminOf} locks the rows it relies on first (the staff
 * Admins' rows in ID order, {@link lockSoleAdminRows}), and runs this as a
 * new statement afterwards, so it sees every change committed before those
 * locks were granted.
 *
 * @param db - Database client or transaction.
 * @param userId - The user to leave out.
 * @returns Whether someone else can still manage the staff.
 */
async function hasOtherActiveAdmin(db: DatabaseOrTransaction, userId: string): Promise<boolean> {
  const [other] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.platformRole, PLATFORM_ADMIN_ROLE),
        isNull(user.deactivatedAt),
        sql`${user.id} <> ${userId}`,
      ),
    )
    .limit(1);
  return Boolean(other);
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
    platformRole === PLATFORM_ADMIN_ROLE && !(await hasOtherActiveAdmin(db, userId));

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
 * Who a refusal about the last Admin is about: the acting user themself
 * ("You are the only staff Admin.") or the user they act on ("This user is
 * ...").
 */
export type SoleAdminSubject = 'self' | 'user';

/**
 * The error for a change that would leave the staff or companies without an
 * Admin, e.g. "This user is the only Admin of Adiutor Tests. Make someone
 * else an Admin first." (`errors.soleAdmin.<subject>.<what>`, with the
 * companies' names as `{companies}`: a list, which whatever shows the error
 * joins in the reader's language, "A, B and C").
 *
 * @param subject - Who it's about.
 * @param sole - What they're the last Admin of.
 * @returns The error (`conflict`), or `null` when nothing would be left without an Admin.
 */
export function soleAdminError(subject: SoleAdminSubject, sole: SoleAdminOf): ServiceError | null {
  const { companies } = sole;
  if (sole.staff && sole.companies.length > 0) {
    return new ServiceError('conflict', `errors.soleAdmin.${subject}.staffAndCompanies`, {
      companies,
    });
  }
  if (sole.staff) {
    return new ServiceError('conflict', `errors.soleAdmin.${subject}.staff`);
  }
  if (sole.companies.length > 0) {
    return new ServiceError('conflict', `errors.soleAdmin.${subject}.companies`, { companies });
  }
  return null;
}

/**
 * Refuses a change that would leave the staff or companies without an Admin
 * who can sign in. With `lock`, it's the change's first locking step: it
 * locks the user's Admin companies, the user's row and, for a staff Admin,
 * the other staff Admins' rows ({@link soleAdminOf}).
 *
 * @param db - Database client or transaction.
 * @param userId - The user who'd lose access.
 * @param subject - Who it's about: the acting user themself, or the user they act on.
 * @param options - How to read (see {@link soleAdminOf}).
 * @param options.lock - Lock first; on by default.
 * @throws {ServiceError} `conflict` naming the companies ({@link soleAdminError}; or asking to try
 *   again when something changed while the locks were taken), `not_found` when the user is gone.
 */
export async function assertNotSoleAdmin(
  db: DatabaseOrTransaction,
  userId: string,
  subject: SoleAdminSubject,
  options: { lock?: boolean } = {},
): Promise<void> {
  const refusal = soleAdminError(subject, await soleAdminOf(db, userId, options));
  if (refusal) {
    throw refusal;
  }
}
