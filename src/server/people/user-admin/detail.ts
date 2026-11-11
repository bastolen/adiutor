/**
 * @file The user detail page's loader (`getUserDetail`) and the check of
 * whether a user exists, for the page's title. Staff only (`users:view`).
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '@/db';
import { account, company, membership, user } from '@/db/schema';
import { type MfaState, type MfaStatus, mfaStatus, requiresMfa } from '@/lib/authz/mfa';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { OAUTH_PROVIDERS } from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { type DeviceSort, USER_COMPANIES_TABLE, type UserCompanySort } from '@/lib/tables/tables';
import { idSchema } from '@/lib/validation';

import { assertPermission, getGlobalPermissions } from '../../access';
import type { Actor } from '../../actor';
import { type AuditEntry, listAuditEvents } from '../../audit';
import { listConnectedProviders } from '../../auth/accounts';
import { loadMfaContext } from '../../auth/mfa-state';
import type { ServiceContext } from '../../context';
import { notFoundError, parseId } from '../../errors';
import { orderTerms, paginate, textOrder } from '../../pagination';
import { asSeenWith, loadSessionRows, type UserSession } from './sessions';

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
   * MFA reset disconnects them all ((`resetUserMfa`)).
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
