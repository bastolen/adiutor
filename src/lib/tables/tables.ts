/**
 * @file The app's sortable, paginated tables: how each one can be sorted,
 * its default order and the prefix of its query parameters (see
 * `src/lib/tables/table-state.ts`). Tables that share a page have different
 * prefixes, and the ones that aren't a page's main table name the anchor of
 * their card (`section`). A card's anchor is unique across the app, not just
 * its page: Next keeps the pages shown last in the document, hidden, so a
 * table on two pages gets a definition per page, with the same prefix (the
 * same address parameters) and its own section. People and companies are
 * sorted by name A to Z until the viewer picks another order; invitations,
 * invite links and devices newest first.
 */
import { dateSort, type SortDefinition, type TableDefinition, textSort } from './table-state';

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

/** How the runs of background jobs can be sorted: by when they started. */
export type JobRunSort = 'time';

/** How the failed queued jobs can be sorted: by when they were given up. */
export type FailedJobSort = 'time';

/** How a webhook's deliveries can be sorted: by when they were made. */
export type WebhookDeliverySort = 'time';

/** How a list of requests can be sorted by everyone who sees it. */
export type RequestSort = 'activity' | 'raised';

/** How the staff can sort a list of requests: also by priority, which only they see. */
export type StaffRequestSort = RequestSort | 'priority';

/**
 * The sorts of a list of people, the same wherever people are listed. What
 * "Joined" sorts by is up to each list: the account's or the membership's
 * creation.
 */
const PEOPLE_SORTS: TableDefinition<PeopleSort>['sorts'] = {
  name: textSort('name'),
  email: textSort('email'),
  'last-active': dateSort('lastActive', { desc: 'mostRecentFirst', asc: 'leastRecentFirst' }),
  joined: dateSort('joined'),
};

/** The users list (`/admin/users`); Joined is when the account was created. */
export const USERS_TABLE: TableDefinition<PeopleSort> = {
  prefix: '',
  defaultSort: 'name',
  sorts: PEOPLE_SORTS,
};

/** The staff (`/admin/settings/staff`); Joined is when the account was created. */
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
  sorts: { name: textSort('company'), added: dateSort('added') },
};

/** The companies of one user, on their page (`/admin/users/[userId]`). */
export const USER_COMPANIES_TABLE: TableDefinition<UserCompanySort> = {
  prefix: 'companies-',
  section: 'companies',
  defaultSort: 'name',
  sorts: { name: textSort('company'), joined: dateSort('joined') },
};

/** Open invitations, on the staff settings (`/admin/settings/staff`). */
export const INVITATIONS_TABLE: TableDefinition<InvitationSort> = {
  prefix: 'inv-',
  section: 'invitations',
  defaultSort: 'sent',
  sorts: { email: textSort('email'), sent: dateSort('sent') },
};

/** Open invitations on a company's Members page: {@link INVITATIONS_TABLE} with its own anchor. */
export const COMPANY_INVITATIONS_TABLE: TableDefinition<InvitationSort> = {
  ...INVITATIONS_TABLE,
  section: 'company-invitations',
};

/** Invite links, on the staff settings (`/admin/settings/staff`). */
export const INVITE_LINKS_TABLE: TableDefinition<InviteLinkSort> = {
  prefix: 'links-',
  section: 'invite-links',
  defaultSort: 'created',
  sorts: { created: dateSort('created') },
};

/** Invite links on a company's Members page: {@link INVITE_LINKS_TABLE} with its own anchor. */
export const COMPANY_INVITE_LINKS_TABLE: TableDefinition<InviteLinkSort> = {
  ...INVITE_LINKS_TABLE,
  section: 'company-invite-links',
};

/** Your own signed-in devices, on your account's Activity page (`/account/activity`). */
export const DEVICES_TABLE: TableDefinition<DeviceSort> = {
  prefix: 'devices-',
  section: 'devices',
  defaultSort: 'signed-in',
  sorts: { 'signed-in': dateSort('signedIn') },
};

/** A user's signed-in devices, on their Activity tab: {@link DEVICES_TABLE} with its own anchor. */
export const USER_DEVICES_TABLE: TableDefinition<DeviceSort> = {
  ...DEVICES_TABLE,
  section: 'user-devices',
};

/** The audit log (`/admin/logs`): every recorded event, newest first. */
export const AUDIT_LOG_TABLE: TableDefinition<AuditLogSort> = {
  prefix: '',
  defaultSort: 'time',
  sorts: { time: dateSort('time') },
};

/** The errors recorded in the last 7 days (`/admin/logs/errors`), newest first. */
export const ERRORS_TABLE: TableDefinition<ErrorSort> = {
  prefix: '',
  defaultSort: 'time',
  sorts: { time: dateSort('time') },
};

/** A webhook's deliveries of the last 30 days, on its page (`/admin/settings/webhooks/[webhookId]`), newest first. */
export const WEBHOOK_DELIVERIES_TABLE: TableDefinition<WebhookDeliverySort> = {
  prefix: '',
  defaultSort: 'time',
  sorts: { time: dateSort('time') },
};

/** The runs of background jobs in the last 30 days (`/admin/logs/jobs`), newest first. */
export const JOB_RUNS_TABLE: TableDefinition<JobRunSort> = {
  prefix: '',
  defaultSort: 'time',
  sorts: { time: dateSort('time') },
};

/** The queued jobs that were given up, on the Jobs page, latest first. */
export const FAILED_JOBS_TABLE: TableDefinition<FailedJobSort> = {
  prefix: 'failed-',
  section: 'failed-jobs',
  defaultSort: 'time',
  sorts: { time: dateSort('time') },
};

/** The sorts of a list of requests: by their last activity, or by when they were raised. */
const REQUEST_SORTS: TableDefinition<RequestSort>['sorts'] = {
  activity: dateSort('activity', { desc: 'mostRecentFirst', asc: 'leastRecentFirst' }),
  raised: dateSort('raised'),
};

/** Sorting by priority, the highest first unless the viewer picks the other way. */
const PRIORITY_SORT: SortDefinition = {
  label: 'priority',
  first: 'desc',
  directions: { desc: 'highestFirst', asc: 'lowestFirst' },
};

/**
 * A list of requests (`/requests`, and a company's page), as company users
 * see it: by default the request with the latest activity first.
 */
export const REQUESTS_TABLE: TableDefinition<RequestSort> = {
  prefix: '',
  defaultSort: 'activity',
  sorts: REQUEST_SORTS,
};

/** The same list as the staff see it, who can also sort it by priority. */
export const STAFF_REQUESTS_TABLE: TableDefinition<StaffRequestSort> = {
  prefix: '',
  defaultSort: 'activity',
  sorts: { ...REQUEST_SORTS, priority: PRIORITY_SORT },
};
