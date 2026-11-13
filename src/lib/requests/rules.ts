/**
 * @file The rules of working on a request, as pure functions of someone's
 * permissions in the request's company (`src/lib/authz/permissions.ts`):
 * which side they act as, how the screens address them, which status changes
 * they may make and what a reply does to the status.
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
  if (from === to) {
    return false;
  }
  if (permissions.has('requests:manage')) {
    return true;
  }
  if (!permissions.has('requests:contribute')) {
    return false;
  }
  // The company closes a request that's still worked on, and reopens a closed one.
  if (to === 'done' || to === 'cancelled') {
    return !isClosedStatus(from);
  }
  return to === 'open' && isClosedStatus(from);
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
