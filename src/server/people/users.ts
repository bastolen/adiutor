/**
 * @file Users: the list of every account, for staff, and the warning about
 * accounts that lost their provider MFA because that provider's sign-in
 * isn't configured on this server.
 */
import { and, asc, eq, ilike, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import type { Database } from '@/db';
import { account, company, membership, user } from '@/db/schema';
import { mfaRoleOf, mfaStatus, type MfaStatus, unavailableProviderMfa } from '@/lib/authz/mfa';
import type { PlatformRole } from '@/lib/authz/roles';
import { defined } from '@/lib/defined';
import { MFA_PROVIDERS, type MfaProvider } from '@/lib/sign-in/oauth-providers';
import { availableProviders } from '@/lib/sign-in/providers';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { type PeopleSort, USERS_TABLE } from '@/lib/tables/tables';

import { assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { loadActiveCompanyAdminIds, loadMfaRoles, loadMfaStates } from '../auth/mfa-state';
import type { ServiceContext } from '../context';
import { paginate, peopleOrder, slicePage } from '../pagination';
import containsPattern from '../search';

/**
 * Ways to narrow the users list: everyone, only the staff, only people who
 * aren't on it, accounts without MFA, or deactivated accounts.
 */
const USER_FILTERS = ['all', 'staff', 'not_staff', 'without_mfa', 'deactivated'] as const;

/** One of {@link USER_FILTERS}. */
export type UserFilter = (typeof USER_FILTERS)[number];

/**
 * Checks whether a value is a known users filter.
 *
 * @param value - The value to check, e.g. from the URL.
 * @returns Whether it is a {@link UserFilter}.
 */
export function isUserFilter(value: unknown): value is UserFilter {
  return USER_FILTERS.includes(value as UserFilter);
}

/** A user in the users list. */
export interface UserListItem {
  /** User ID. */
  id: string;
  /** Display name (may be empty). */
  name: string;
  /** Email address. */
  email: string;
  /** When the account was created. */
  createdAt: Date;
  /** Whether the email address is verified. */
  emailVerified: boolean;
  /** When they last did something in the app, or `null` if never. */
  lastActiveAt: Date | null;
  /** When the account was deactivated, or `null` while active. */
  deactivatedAt: Date | null;
  /** How the account stands with the MFA rules. */
  mfa: MfaStatus;
  /** Their staff role (platform role), or `null` if they aren't on it. */
  staffRole: PlatformRole | null;
  /** The companies they belong to, by name, with the URL name their links use. */
  companies: { id: string; name: string; slug: string }[];
}

/** Options for {@link listUsers}: search, filter, and the table's sort and page. */
export interface ListUsersOptions extends Partial<TableState<PeopleSort>> {
  /** Text to match anywhere in the name or email address. */
  search?: string;
  /** Which users to include. Defaults to `all`. */
  filter?: UserFilter;
}

/**
 * Works out how users stand with the MFA rules (`mfaStatus` in
 * `src/lib/authz/mfa/`), with the providers configured here.
 *
 * @param db - Database client.
 * @param rows - The users, with their staff role.
 * @returns Their MFA status by user ID.
 */
async function mfaStatuses(
  db: Database,
  rows: readonly { id: string; staffRole: PlatformRole | null }[],
): Promise<Map<string, MfaStatus>> {
  const ids = rows.map(({ id }) => id);
  const [states, admins] = await Promise.all([
    loadMfaStates(db, ids),
    loadActiveCompanyAdminIds(db, ids),
  ]);
  return new Map(
    rows.map((row) => [
      row.id,
      mfaStatus(
        defined(states.get(row.id), 'the MFA state of a listed user'),
        mfaRoleOf(row.staffRole, admins.has(row.id)),
        availableProviders,
      ),
    ]),
  );
}

/**
 * Loads the companies of some users, each user's by name.
 *
 * @param db - Database client.
 * @param userIds - The users.
 * @returns Their companies by user ID; users without any are missing.
 */
async function companiesOf(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, { id: string; name: string; slug: string }[]>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ userId: membership.userId, id: company.id, name: company.name, slug: company.slug })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(inArray(membership.userId, [...userIds]))
    .orderBy(asc(company.name), asc(company.id));
  const byUser = new Map<string, { id: string; name: string; slug: string }[]>();
  rows.forEach(({ userId, ...entry }) => {
    byUser.set(userId, [...(byUser.get(userId) ?? []), entry]);
  });
  return byUser;
}

/**
 * Lists the user accounts, one page at a time, by name A to Z unless asked
 * otherwise. Staff only (`users:view`).
 *
 * Whether an account has MFA follows the rules in `src/lib/authz/mfa/` and
 * which providers are configured, so the `without_mfa` filter can't be
 * written in SQL: for it, every matching account is loaded (in order, with
 * just the list's columns), filtered, then paged. That is fine for
 * thousands of users; around 10,000, store the MFA status instead (its ID
 * lists also stop working above 65,535 accounts). Every other filter is
 * applied, counted and paged in SQL, and MFA status is worked out for the
 * page shown only. Either way, companies are loaded for the page shown only.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:view` (staff).
 * @param options - Search text, filter, sort and page.
 * @returns The page of users with their staff role, MFA status and companies.
 * @throws {ServiceError} `forbidden` for anyone who isn't staff.
 */
export async function listUsers(
  ctx: ServiceContext,
  actor: Actor,
  options: ListUsersOptions = {},
): Promise<Paged<UserListItem>> {
  assertPermission(getGlobalPermissions(actor), 'users:view');
  const { search = '', filter = 'all', ...table } = options;
  const state = resolveTableState(USERS_TABLE, table);

  const term = search.trim();
  const pattern = containsPattern(term);
  let filterCondition;
  if (filter === 'staff') {
    filterCondition = isNotNull(user.platformRole);
  }
  if (filter === 'not_staff') {
    filterCondition = isNull(user.platformRole);
  }
  if (filter === 'deactivated') {
    filterCondition = isNotNull(user.deactivatedAt);
  }
  const where = and(
    term ? or(ilike(user.name, pattern), ilike(user.email, pattern)) : undefined,
    filterCondition,
  );
  const order = peopleOrder(state, {
    name: user.name,
    email: user.email,
    lastActiveAt: user.lastActiveAt,
    joined: user.createdAt,
    id: user.id,
  });

  /**
   * Starts the query for the matching users, in order.
   *
   * @returns The query.
   */
  const matching = () =>
    ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
        lastActiveAt: user.lastActiveAt,
        deactivatedAt: user.deactivatedAt,
        staffRole: user.platformRole,
      })
      .from(user)
      .where(where)
      .orderBy(...order);

  let page;
  let companies;
  if (filter === 'without_mfa') {
    // The statuses choose the page, so they come first, then that page's companies.
    const all = await matching();
    const statuses = await mfaStatuses(ctx.db, all);
    page = slicePage(
      all
        .map((row) => ({ ...row, mfa: defined(statuses.get(row.id), 'the MFA status of a user') }))
        .filter((row) => row.mfa !== 'protected'),
      state,
    );
    companies = await companiesOf(
      ctx.db,
      page.items.map(({ id }) => id),
    );
  } else {
    const rows = await paginate(
      state,
      () => ctx.db.$count(user, where),
      (limit, offset) => matching().limit(limit).offset(offset),
    );
    // Both need only the page's rows, so they load together.
    const [statuses, byUser] = await Promise.all([
      mfaStatuses(ctx.db, rows.items),
      companiesOf(
        ctx.db,
        rows.items.map(({ id }) => id),
      ),
    ]);
    page = {
      ...rows,
      items: rows.items.map((row) => ({
        ...row,
        mfa: defined(statuses.get(row.id), 'the MFA status of a user'),
      })),
    };
    companies = byUser;
  }
  return {
    ...page,
    items: page.items.map((row): UserListItem => ({
      ...row,
      staffRole: row.staffRole ?? null,
      companies: companies.get(row.id) ?? [],
    })),
  };
}

/** Accounts that lost their provider MFA (see {@link getProviderMfaWarning}). */
export interface ProviderMfaWarning {
  /** How many active accounts, whose role requires MFA, have none because of it. */
  count: number;
  /** The providers they relied on whose sign-in isn't configured, e.g. `['github']`. */
  providers: MfaProvider[];
}

/**
 * Finds the active accounts whose role requires MFA and whose only MFA is an
 * account of a provider that isn't configured on this server (e.g. after a
 * deploy lost GitHub's credentials, `unavailableProviderMfa`): until it's
 * back, they're asked to set up a passkey or an authenticator app, and so is
 * whoever controls their inbox. Accounts that still have MFA another way
 * (another configured provider, a passkey, an authenticator app) aren't
 * counted. For staff Admins (`users:manage`), on the dashboard.
 *
 * @param ctx - Service context (only the database is used).
 * @param actor - The signed-in user.
 * @returns The warning, or `null` when there's nothing to warn about or the user may not see it.
 */
export async function getProviderMfaWarning(
  ctx: Pick<ServiceContext, 'db'>,
  actor: Actor,
): Promise<ProviderMfaWarning | null> {
  if (!getGlobalPermissions(actor).has('users:manage')) {
    return null;
  }
  const missing = MFA_PROVIDERS.filter((provider) => !availableProviders.includes(provider));
  if (missing.length === 0) {
    return null;
  }
  const rows = await ctx.db
    .selectDistinct({ userId: account.userId })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(
      and(
        inArray(account.providerId, missing),
        eq(account.mfaVerified, true),
        eq(account.confirmed, true),
        isNull(user.deactivatedAt),
      ),
    );
  const userIds = rows.map((row) => row.userId);
  if (userIds.length === 0) {
    return null;
  }
  const [states, roles] = await Promise.all([
    loadMfaStates(ctx.db, userIds),
    loadMfaRoles(ctx.db, userIds),
  ]);
  const lost = userIds.map((id) => {
    const state = states.get(id);
    return state ? unavailableProviderMfa(state, roles.get(id) ?? null, availableProviders) : [];
  });
  const count = lost.filter((providers) => providers.length > 0).length;
  if (count === 0) {
    return null;
  }
  return { count, providers: MFA_PROVIDERS.filter((provider) => lost.flat().includes(provider)) };
}
