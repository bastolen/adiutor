/**
 * @file The user page's loaders, one per tab's data: the user themself
 * (`getUserDetail`, for the header, Overview and Manage), their companies
 * (`listUserCompanies`) and their signed-in devices (`listUserDevices`),
 * and the check of whether a user exists, for the pages' titles. Staff only
 * (`users:view`); devices for staff Admins (`users:manage`). Their recent
 * activity is `listAuditEvents`.
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '@/db';
import { account, company, membership, user } from '@/db/schema';
import { reactivationNeedsConfirmation } from '@/lib/authz/guards';
import { type MfaState, type MfaStatus, mfaStatus, requiresMfa } from '@/lib/authz/mfa';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { OAUTH_PROVIDERS } from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { type DeviceSort, USER_COMPANIES_TABLE, type UserCompanySort } from '@/lib/tables/tables';
import { idSchema } from '@/lib/validation';

import { assertPermission, getGlobalPermissions } from '../../access';
import type { Actor } from '../../actor';
import { listConnectedProviders } from '../../auth/accounts';
import { loadMfaContext } from '../../auth/mfa-state';
import type { ServiceContext } from '../../context';
import { notFoundError, parseId } from '../../errors';
import { orderTerms, paginate, textOrder } from '../../pagination';
import { loadPictures } from '../pictures';
import loadKeptRoles from './kept-roles';
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

/** A user, as their page's header, Overview and Manage tabs show them. */
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
  /** Their picture's address (`loadPictures`), or `null` for their initials. */
  picture: string | null;
  /**
   * The names of their provider accounts at the providers (a GitHub username,
   * a Google email address), by account ID, or `null` without `users:manage`
   * (Admins only). A name is `null` while it isn't known yet.
   */
  accountNames: Record<string, string | null> | null;
  /**
   * Whether reactivating the account gives back a role that needs the
   * Admin's confirmation with their second step from the last 15 minutes
   * (`reactivationNeedsConfirmation`): a staff role or a company's Admin
   * role it kept. Always `false` while the account is active.
   */
  reactivationNeedsConfirmation: boolean;
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
  const accounts = await listConnectedProviders({ db }, userId);
  return Object.fromEntries(accounts.map(({ id, accountName }) => [id, accountName]));
}

/**
 * Finds a user by ID for the loaders below.
 *
 * @param ctx - Service context.
 * @param userId - The user (unvalidated input is fine).
 * @returns Their row.
 * @throws {ServiceError} `not_found` for unknown users and what isn't an ID.
 */
async function findUser(ctx: ServiceContext, userId: string) {
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
    .where(eq(user.id, parseId(userId)));
  if (!found) {
    throw notFoundError();
  }
  return found;
}

/**
 * Loads a user for their page's header and its Overview and Manage tabs.
 * Staff only (`users:view`).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:view`.
 * @param userId - The user (unvalidated input is fine).
 * @returns The user's details.
 * @throws {ServiceError} `forbidden` for non-staff, `not_found` for unknown users.
 */
export async function getUserDetail(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
): Promise<UserDetail> {
  const permissions = getGlobalPermissions(actor);
  assertPermission(permissions, 'users:view');
  const found = await findUser(ctx, userId);
  const { id } = found;
  const [mfa, connectedAccounts, accountNames, pictures, keptRoles] = await Promise.all([
    // The MFA role comes from all their memberships.
    loadMfaContext(ctx.db, id),
    ctx.db.$count(
      account,
      and(eq(account.userId, id), inArray(account.providerId, [...OAUTH_PROVIDERS])),
    ),
    permissions.has('users:manage') ? loadAccountNames(ctx.db, id) : null,
    loadPictures(ctx.db, [id]),
    // What reactivating gives back, only while there's something to reactivate.
    found.deactivatedAt ? loadKeptRoles(ctx.db, id) : null,
  ]);
  if (!mfa) {
    throw notFoundError();
  }
  const { state, mfaRole } = mfa;

  return {
    ...found,
    staffRole: found.staffRole ?? null,
    mfa: {
      ...state,
      status: mfaStatus(state, mfaRole, availableProviders),
      required: requiresMfa(mfaRole),
    },
    connectedAccounts,
    accountNames,
    picture: pictures.get(id) ?? null,
    reactivationNeedsConfirmation: keptRoles ? reactivationNeedsConfirmation(keptRoles) : false,
  };
}

/**
 * Loads a page of a user's companies, for the Companies tab of their page
 * (by default by name). Staff only (`users:view`).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:view`.
 * @param userId - The user (unvalidated input is fine).
 * @param options - Sort and page of the table (`USER_COMPANIES_TABLE`).
 * @returns One page of their companies, with the total.
 * @throws {ServiceError} `forbidden` for non-staff, `not_found` for unknown users.
 */
export async function listUserCompanies(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  options: Partial<TableState<UserCompanySort>> = {},
): Promise<Paged<UserCompany>> {
  assertPermission(getGlobalPermissions(actor), 'users:view');
  const { id } = await findUser(ctx, userId);
  const state = resolveTableState(USER_COMPANIES_TABLE, options);
  const ofUser = eq(membership.userId, id);
  const companyOrder =
    state.sort === 'joined'
      ? orderTerms(state.dir, membership.createdAt, membership.id)
      : orderTerms(state.dir, textOrder(company.name), company.id);
  const companies = await paginate(
    state,
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
  );
  return {
    ...companies,
    items: companies.items.map(({ deactivatedAt, ...row }) => ({
      ...row,
      deactivated: Boolean(deactivatedAt),
    })),
  };
}

/**
 * Loads a page of a user's signed-in devices, for the Activity tab of their
 * page (by default most recent first). IP addresses and devices are for staff
 * Admins only (`users:manage`). Whether each sign-in counts as MFA is judged
 * with the MFA role their memberships give them now.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:manage`.
 * @param userId - The user (unvalidated input is fine).
 * @param options - Sort and page of the table (`USER_DEVICES_TABLE`, sorted as `DEVICES_TABLE`).
 * @returns One page of their devices, with the total.
 * @throws {ServiceError} `forbidden` without `users:manage`, `not_found` for unknown users.
 */
export async function listUserDevices(
  ctx: ServiceContext,
  actor: Actor,
  userId: string,
  options: Partial<TableState<DeviceSort>> = {},
): Promise<Paged<UserSession>> {
  assertPermission(getGlobalPermissions(actor), 'users:manage');
  const { id } = await findUser(ctx, userId);
  const [mfa, sessions] = await Promise.all([
    loadMfaContext(ctx.db, id),
    loadSessionRows(ctx.db, id, options),
  ]);
  if (!mfa) {
    throw notFoundError();
  }
  return asSeenWith(sessions, mfa.mfaRole);
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
