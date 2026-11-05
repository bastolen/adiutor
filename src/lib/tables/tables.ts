/**
 * @file The app's sortable, paginated tables: how each one can be sorted,
 * its default order and the prefix of its query parameters (see
 * `src/lib/tables/table-state.ts`). Tables that share a page have different
 * prefixes, and the ones that aren't a page's main table name the anchor of
 * their card (`section`). People and companies are sorted by name A to Z until the viewer
 * picks another order; invitations, invite links and devices newest first.
 */
import { dateSort, type TableDefinition, textSort } from './table-state';

/** How a list of people (users, staff, members) can be sorted. */
export type PeopleSort = 'name' | 'email' | 'last-active' | 'joined';

/** How the companies list can be sorted. */
export type CompanySort = 'name' | 'added';

/** How a user's companies can be sorted. */
export type UserCompanySort = 'name' | 'joined';

/** How open invitations can be sorted. */
export type InvitationSort = 'email' | 'sent';

/** How invite links can be sorted. */
export type InviteLinkSort = 'created';

/** How signed-in devices can be sorted. */
export type DeviceSort = 'signed-in';

/** How the audit log can be sorted. */
export type AuditLogSort = 'time';

/** How the recent errors can be sorted. */
export type ErrorSort = 'time';

/**
 * The sorts of a list of people, the same wherever people are listed. What
 * "Joined" sorts by is up to each list: the account's or the membership's
 * creation.
 */
const PEOPLE_SORTS: TableDefinition<PeopleSort>['sorts'] = {
  name: textSort('Name'),
  email: textSort('Email'),
  'last-active': dateSort('Last active', {
    desc: 'most recent first',
    asc: 'least recent first',
  }),
  joined: dateSort('Joined'),
};

/** The users list (`/admin/users`); Joined is when the account was created. */
export const USERS_TABLE: TableDefinition<PeopleSort> = {
  prefix: '',
  defaultSort: 'name',
  sorts: PEOPLE_SORTS,
};

/** The staff (`/admin/staff`); Joined is when the account was created. */
export const STAFF_TABLE: TableDefinition<PeopleSort> = {
  prefix: '',
  defaultSort: 'name',
  sorts: PEOPLE_SORTS,
};

/** A company's members; Joined is when they joined the company. */
export const MEMBERS_TABLE: TableDefinition<PeopleSort> = {
  prefix: '',
  defaultSort: 'name',
  sorts: PEOPLE_SORTS,
};

/** The companies list (`/admin/companies`). */
export const COMPANIES_TABLE: TableDefinition<CompanySort> = {
  prefix: '',
  defaultSort: 'name',
  sorts: { name: textSort('Company'), added: dateSort('Added') },
};

/** The companies of one user, on their page (`/admin/users/[userId]`). */
export const USER_COMPANIES_TABLE: TableDefinition<UserCompanySort> = {
  prefix: 'companies-',
  section: 'companies',
  defaultSort: 'name',
  sorts: { name: textSort('Company'), joined: dateSort('Joined') },
};

/** Open invitations, on the members and staff pages. */
export const INVITATIONS_TABLE: TableDefinition<InvitationSort> = {
  prefix: 'inv-',
  section: 'invitations',
  defaultSort: 'sent',
  sorts: { email: textSort('Email'), sent: dateSort('Sent') },
};

/** Invite links, on the members and staff pages. */
export const INVITE_LINKS_TABLE: TableDefinition<InviteLinkSort> = {
  prefix: 'links-',
  section: 'invite-links',
  defaultSort: 'created',
  sorts: { created: dateSort('Created') },
};

/** Signed-in devices, on a user's page and the Security page. */
export const DEVICES_TABLE: TableDefinition<DeviceSort> = {
  prefix: 'devices-',
  section: 'devices',
  defaultSort: 'signed-in',
  sorts: { 'signed-in': dateSort('Signed in') },
};

/** The audit log (`/admin/logs`): every recorded event, newest first. */
export const AUDIT_LOG_TABLE: TableDefinition<AuditLogSort> = {
  prefix: '',
  defaultSort: 'time',
  sorts: { time: dateSort('Time') },
};

/** The errors recorded in the last 7 days (`/admin/logs/errors`), newest first. */
export const ERRORS_TABLE: TableDefinition<ErrorSort> = {
  prefix: '',
  defaultSort: 'time',
  sorts: { time: dateSort('Time') },
};
