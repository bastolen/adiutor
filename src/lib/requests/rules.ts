/**
 * @file The rules of working on a request, as pure functions of someone's
 * permissions in the request's company (`src/lib/authz/permissions.ts`):
 * which side they act as, how the screens address them, which status changes
 * they may make, what a reply does to the status, who can be assigned, and
 * who may edit a request's description and its replies.
 *
 * The staff who work on requests (`requests:manage`) set any status. People
 * who take part from the company (`requests:contribute`) can mark a request
 * done, cancel it and reopen it, and nothing else.
 */
import type { Permission } from '../authz/permissions';
import { isClosedStatus, REQUEST_STATUSES, type RequestSide, type RequestStatus } from './values';

/**
 * Who reads a request, for the wording of what it shows (a request waiting
 * for the company is "waiting for your reply" to those who can reply):
 * the staff, someone at the company who takes part, or someone who only
 * follows (a Watcher).
 */
export type RequestAudience = 'staff' | 'contributor' | 'follower';

/**
 * Which side of a request someone acts as. Whoever works on requests as
 * staff acts as the staff, also in a company they're a member of; everyone
 * else acts as the company, including staff who only read requests (Finance)
 * and take part through their own membership.
 *
 * @param permissions - Their permissions in the request's company.
 * @returns The side.
 */
export function requestSide(permissions: ReadonlySet<Permission>): RequestSide {
  return permissions.has('requests:manage') ? 'staff' : 'company';
}

/**
 * How the screens address someone reading a request.
 *
 * @param permissions - Their permissions in the request's company.
 * @param isMember - Whether they're a member of that company.
 * @returns `staff` for those who work on requests and for staff who aren't
 *   members, `contributor` for members who take part, `follower` otherwise.
 */
export function requestAudience(
  permissions: ReadonlySet<Permission>,
  isMember: boolean,
): RequestAudience {
  if (permissions.has('requests:manage') || !isMember) {
    return 'staff';
  }
  return permissions.has('requests:contribute') ? 'contributor' : 'follower';
}

/**
 * Whether a status change reopens a request: it was done or cancelled and
 * someone works on it again. A reopened request says so until it's closed
 * again.
 *
 * @param from - The status it has.
 * @param to - The status it gets.
 * @returns Whether the change reopens it.
 */
export function isReopening(from: RequestStatus, to: RequestStatus): boolean {
  return isClosedStatus(from) && !isClosedStatus(to);
}

/**
 * The statuses someone who takes part from the company can ever set: the
 * ones that close a request, and `open`, which a reopened request gets.
 */
const CONTRIBUTOR_STATUSES: readonly RequestStatus[] = ['open', 'done', 'cancelled'];

/**
 * Whether someone may ever give a request a status, whatever status it has
 * now. Asking for a status this refuses is asking for something they may
 * not do; a status it allows can still be the wrong move for the request as
 * it is by then ({@link mayChangeStatus}).
 *
 * @param permissions - Their permissions in the request's company.
 * @param to - The status they want.
 * @returns Whether they may ever set it.
 */
export function maySetStatus(permissions: ReadonlySet<Permission>, to: RequestStatus): boolean {
  if (permissions.has('requests:manage')) {
    return true;
  }
  return permissions.has('requests:contribute') && CONTRIBUTOR_STATUSES.includes(to);
}

/**
 * Whether someone may change a request's status. A change to the status it
 * already has is never allowed: there's nothing to change.
 *
 * @param permissions - Their permissions in the request's company.
 * @param from - The status the request has.
 * @param to - The status they want.
 * @returns Whether they may.
 */
export function mayChangeStatus(
  permissions: ReadonlySet<Permission>,
  from: RequestStatus,
  to: RequestStatus,
): boolean {
  if (from === to || !maySetStatus(permissions, to)) {
    return false;
  }
  if (permissions.has('requests:manage')) {
    return true;
  }
  // The company closes a request that's still worked on, and reopens a closed one.
  return to === 'open' ? isClosedStatus(from) : !isClosedStatus(from);
}

/**
 * The statuses someone may move a request to, in the order of
 * {@link REQUEST_STATUSES}.
 *
 * @param permissions - Their permissions in the request's company.
 * @param from - The status the request has.
 * @returns The statuses; empty when they can't change it.
 */
export function statusChoices(
  permissions: ReadonlySet<Permission>,
  from: RequestStatus,
): RequestStatus[] {
  return REQUEST_STATUSES.filter((to) => mayChangeStatus(permissions, from, to));
}

/**
 * The status a request has after someone replies: a reply from the company
 * to a request that was waiting for it puts the request back in progress.
 * Every other reply leaves the status alone, also on a closed request.
 *
 * @param side - The side that replied.
 * @param status - The status the request had.
 * @returns The status it has now.
 */
export function statusAfterReply(side: RequestSide, status: RequestStatus): RequestStatus {
  return side === 'company' && status === 'waiting' ? 'in_progress' : status;
}

/**
 * Whether someone can be assigned to a request: a staff member who works on
 * requests (Admin, Manager or Support). Staff roles count in every company
 * alike, so this takes their staff permissions in companies
 * (`getStaffPermissionsInCompanies`). Finance reads requests but doesn't
 * work on them, and a company's own people take part as the company.
 *
 * @param permissions - Their staff permissions in companies.
 * @returns Whether they can be assigned.
 */
export function mayBeAssigned(permissions: ReadonlySet<Permission>): boolean {
  return permissions.has('requests:manage');
}

/**
 * Whether someone may edit a request's description: while it's open, the
 * staff who work on requests, and anyone at the company who takes part (a
 * Watcher only reads). Its title stays the staff's (Edit details).
 *
 * @param permissions - Their permissions in the request's company.
 * @param status - The request's status.
 * @returns Whether they may.
 */
export function mayEditDescription(
  permissions: ReadonlySet<Permission>,
  status: RequestStatus,
): boolean {
  return (
    !isClosedStatus(status) &&
    (permissions.has('requests:manage') || permissions.has('requests:contribute'))
  );
}

/**
 * Whether someone may edit a reply: only the one who wrote it, while the
 * request is open, and only while they still take part in it or work on it.
 *
 * @param permissions - Their permissions in the request's company.
 * @param status - The request's status.
 * @param isAuthor - Whether they wrote the reply.
 * @returns Whether they may.
 */
export function mayEditReply(
  permissions: ReadonlySet<Permission>,
  status: RequestStatus,
  isAuthor: boolean,
): boolean {
  return isAuthor && mayEditDescription(permissions, status);
}

/**
 * Whose subscriptions to a request someone may change: everyone's who can
 * be subscribed to it, their colleagues' at the request's company, or only
 * their own.
 */
export type SubscriberScope = 'everyone' | 'colleagues' | 'self';

/**
 * Whose subscriptions someone may change, besides their own. The staff who
 * work on requests subscribe and unsubscribe anyone who can be subscribed:
 * the request's company and the staff. A company's Admins, who manage its
 * members, do so for their colleagues, and never learn which staff members
 * follow a request. Everyone else changes only their own.
 *
 * @param permissions - Their permissions in the request's company.
 * @returns The scope.
 */
export function subscriberScope(permissions: ReadonlySet<Permission>): SubscriberScope {
  if (permissions.has('requests:manage')) {
    return 'everyone';
  }
  return permissions.has('members:manage') ? 'colleagues' : 'self';
}
