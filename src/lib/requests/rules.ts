/**
 * @file The rules of working on a request, as pure functions of someone's
 * permissions in the request's company (`src/lib/authz/permissions.ts`):
 * which side they act as, how the screens address them, which status changes
 * they may make, what a reply does to the status, who can be assigned, and
 * who may edit a request's description and its replies.
 *
 * The staff who work on requests (`requests:manage`) set any status. People
 * who take part from the company (`requests:contribute`) can mark a request
 * done, cancel it and reopen it, and nothing else. An internal request, the
 * staff's own without a company (decision 0048), has nobody to approve a
 * solution, so it never waits for one.
 */
import type { Permission } from '../authz/permissions';
import { isClosedStatus, REQUEST_STATUSES, type RequestSide, type RequestStatus } from './values';

/**
 * Where a request is: in a company, or internal, the staff's own without one
 * (decision 0048), which only the staff read.
 */
export type RequestPlace = 'company' | 'internal';

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
 * it is by then ({@link mayChangeStatus}). Waiting for approval (`proposed`)
 * is the staff's, and comes only with the reply that holds the solution
 * ({@link mayProposeSolution}); the company leaves it by approving or denying
 * ({@link mayAnswerSolution}), or by cancelling. An internal request never
 * waits for an approval, which nobody could give.
 *
 * @param permissions - Their permissions in the request's company.
 * @param to - The status they want.
 * @param place - Where the request is.
 * @returns Whether they may ever set it.
 */
export function maySetStatus(
  permissions: ReadonlySet<Permission>,
  to: RequestStatus,
  place: RequestPlace,
): boolean {
  if (place === 'internal' && to === 'proposed') {
    return false;
  }
  if (permissions.has('requests:manage')) {
    return true;
  }
  return permissions.has('requests:contribute') && CONTRIBUTOR_STATUSES.includes(to);
}

/**
 * Whether someone may change a request's status. A change to the status it
 * already has is never allowed: there's nothing to change. Nor is a change
 * to waiting for approval: that comes only with the reply that holds the
 * solution ({@link mayProposeSolution}).
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
  // Waiting for approval, the one status where the request is decides, is refused first.
  if (from === to || to === 'proposed' || !maySetStatus(permissions, to, 'company')) {
    return false;
  }
  if (permissions.has('requests:manage')) {
    return true;
  }
  // The company closes a request that's still worked on, and reopens a closed one. A solution
  // that waits for approval is approved or denied (`answerSolution`), not marked as done.
  if (from === 'proposed' && to === 'done') {
    return false;
  }
  return to === 'open' ? isClosedStatus(from) : !isClosedStatus(from);
}

/**
 * What a change of status was, for the sentence that tells it: reopening,
 * closing (done or cancelled), proposing a solution, the company's answer to
 * one (approved or denied), or another move.
 *
 * @param from - The status it had.
 * @param to - The status it got.
 * @param side - The side that changed it.
 * @returns The kind of change.
 */
export function statusChangeKind(
  from: RequestStatus,
  to: RequestStatus,
  side: RequestSide,
): 'reopened' | 'done' | 'cancelled' | 'proposed' | 'approved' | 'denied' | 'moved' {
  if (isReopening(from, to)) {
    return 'reopened';
  }
  if (from === 'proposed' && side === 'company' && (to === 'done' || to === 'in_progress')) {
    return to === 'done' ? 'approved' : 'denied';
  }
  if (to === 'done' || to === 'cancelled' || to === 'proposed') {
    return to;
  }
  return 'moved';
}

/**
 * Whether someone may write on a request and change it: they take part in
 * its company's requests (`requests:contribute`, which the staff who work on
 * requests have too), and only while the company is active. A deactivated
 * company's requests can only be read; the services refuse every change to
 * them (`requestToChange`).
 *
 * @param permissions - Their permissions in the request's company.
 * @param company - The request's company, with whether it's deactivated; `null` for an internal
 *   request, which has none.
 * @returns Whether they may.
 */
export function mayContribute(
  permissions: ReadonlySet<Permission>,
  company: { deactivated: boolean } | null,
): boolean {
  return company?.deactivated !== true && permissions.has('requests:contribute');
}

/**
 * Whether someone may send a reply that makes the request wait for the
 * company ("Send and wait"): a change to waiting they may make
 * ({@link mayChangeStatus}: the staff who work on requests, on a request that
 * doesn't wait already), on a request that's still worked on. A reply never
 * reopens a closed request.
 *
 * @param permissions - Their permissions in the request's company.
 * @param from - The status the request has.
 * @returns Whether they may.
 */
export function mayWaitWithReply(
  permissions: ReadonlySet<Permission>,
  from: RequestStatus,
): boolean {
  return !isClosedStatus(from) && mayChangeStatus(permissions, from, 'waiting');
}

/**
 * Whether someone may send a reply as the solution, so the request waits for
 * the company's approval (`proposed`, decision 0033): the staff who work on
 * requests, on a company's request that's still worked on and doesn't wait
 * for an approval already. Never on an internal request, where nobody could
 * answer it.
 *
 * @param permissions - Their permissions in the request's company.
 * @param from - The status the request has.
 * @param place - Where the request is.
 * @returns Whether they may.
 */
export function mayProposeSolution(
  permissions: ReadonlySet<Permission>,
  from: RequestStatus,
  place: RequestPlace,
): boolean {
  return (
    place === 'company' &&
    permissions.has('requests:manage') &&
    !isClosedStatus(from) &&
    from !== 'proposed'
  );
}

/**
 * Whether a reply may give the request the status asked for with it, as the
 * request is when the reply is stored: as the solution ({@link mayProposeSolution}),
 * waiting for the company ({@link mayWaitWithReply}), or any other change
 * they may make ({@link mayChangeStatus}). A status this refuses is left
 * alone: the reply still counts.
 *
 * @param permissions - Their permissions in the request's company.
 * @param from - The status the request has.
 * @param to - The status asked for with the reply.
 * @param place - Where the request is.
 * @returns Whether the reply sets it.
 */
export function mayReplyWithStatus(
  permissions: ReadonlySet<Permission>,
  from: RequestStatus,
  to: RequestStatus,
  place: RequestPlace,
): boolean {
  if (to === 'proposed') {
    return mayProposeSolution(permissions, from, place);
  }
  if (to === 'waiting') {
    return mayWaitWithReply(permissions, from);
  }
  return mayChangeStatus(permissions, from, to);
}

/** How the company answers a solution the staff sent: it solves the request, or it doesn't. */
export const SOLUTION_ANSWERS = ['approve', 'deny'] as const;

/** One answer to a solution. */
export type SolutionAnswer = (typeof SOLUTION_ANSWERS)[number];

/**
 * Whether someone may approve or deny the solution a request waits on:
 * someone at the company who takes part in its requests (an Admin or a
 * Client, not a Watcher), and not the staff, who sent it.
 *
 * @param permissions - Their permissions in the request's company.
 * @param from - The status the request has.
 * @returns Whether they may.
 */
export function mayAnswerSolution(
  permissions: ReadonlySet<Permission>,
  from: RequestStatus,
): boolean {
  return (
    from === 'proposed' &&
    permissions.has('requests:contribute') &&
    !permissions.has('requests:manage')
  );
}

/**
 * The status an answer to a solution gives the request: approving closes
 * it, denying puts it back in progress.
 *
 * @param answer - The answer.
 * @returns The status.
 */
export function statusAfterAnswer(answer: SolutionAnswer): RequestStatus {
  return answer === 'approve' ? 'done' : 'in_progress';
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
 * Whether someone may write an internal note on a request: only the staff
 * who work on requests (`requests:manage`). Finance reads notes
 * (`requests:view-internal`) but doesn't write them, and nobody at a company
 * ever sees one.
 *
 * @param permissions - Their permissions in the request's company.
 * @returns Whether they may.
 */
export function mayWriteNote(permissions: ReadonlySet<Permission>): boolean {
  return permissions.has('requests:manage');
}

/**
 * Whether someone may remove a file attached to a request's text: only the
 * staff who work on requests (`requests:manage`), whoever attached it and
 * whatever the request's status (decision 0044). Its file is deleted then,
 * and its place in the text says who removed it.
 *
 * @param permissions - Their permissions in the request's company.
 * @returns Whether they may.
 */
export function mayRemoveAttachment(permissions: ReadonlySet<Permission>): boolean {
  return permissions.has('requests:manage');
}

/**
 * Whether someone may edit an internal note: only the one who wrote it,
 * while the request is open, and only while they still work on requests.
 *
 * @param permissions - Their permissions in the request's company.
 * @param status - The request's status.
 * @param isAuthor - Whether they wrote the note.
 * @returns Whether they may.
 */
export function mayEditNote(
  permissions: ReadonlySet<Permission>,
  status: RequestStatus,
  isAuthor: boolean,
): boolean {
  return isAuthor && !isClosedStatus(status) && mayWriteNote(permissions);
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
