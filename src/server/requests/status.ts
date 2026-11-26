/**
 * @file Changing a request's status: the staff move it along, and either
 * side marks it done, cancels it or reopens it.
 */
import {
  isReopening,
  mayChangeStatus,
  maySetStatus,
  requestSide,
  type RequestStatus,
} from '@/lib/requests';
import { requestStatusSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { forbiddenError, ServiceError } from '../errors';
import {
  assertChangeLimit,
  changeRequest,
  recordStatusChange,
  requestToChange,
  workingPermission,
} from './change';
import { tellPeopleOnRequest } from './tell-people';
import { tellWebhooks } from './tell-webhooks';

/**
 * Changes a request's status. The staff who work on requests set any
 * status; people who take part from the company mark a request done or
 * cancel it while it's still worked on, and reopen one that's closed, which
 * makes it open again.
 *
 * A request that already has the status stays as it is, without an entry in
 * its history: two people marking it done at the same moment both succeed.
 *
 * Everyone else on the request is told by email (`tellPeopleOnRequest`).
 *
 * A change can say which status it started from (`from`, the one the reader saw). When the
 * request has another status by now, a colleague changed it first: nothing changes, nobody is
 * emailed and the change is refused, also for the staff, who may make any move. Without `from`,
 * the staff's change overwrites whatever the status is, and a company's change is refused only
 * when the move is no longer allowed.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the request's company, and
 *   `requests:manage` for the statuses only the staff set.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.status - The new status (`REQUEST_STATUSES`).
 * @param input.from - The status the reader saw (`REQUEST_STATUSES`), when it must still be that.
 * @returns Whether anything changed, whether that reopened the request, and its status.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request, `forbidden` without
 *   `requests:contribute` or when the status isn't theirs to set, `invalid` when the company is
 *   deactivated, `rate_limited` when the actor has changed requests too often
 *   (`RATE_LIMITS.requestChangesPerUser`), `conflict` when the request's status changed
 *   meanwhile: to one this change can't follow (reopening a request that's open again), or, with
 *   `from`, to any other than `from`.
 * @throws {ZodError} When the status or `from` isn't one.
 */
export default async function changeRequestStatus(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; status: string; from?: string },
): Promise<{ changed: boolean; reopened: boolean; status: RequestStatus }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:contribute');
  const { permissions } = access;
  const status = requestStatusSchema.parse(input.status);
  const from = input.from === undefined ? undefined : requestStatusSchema.parse(input.from);
  // Waiting for approval comes only with the reply that holds the solution (`replyToRequest`).
  if (
    status === 'proposed' ||
    !maySetStatus(permissions, status, access.company === null ? 'internal' : 'company')
  ) {
    throw forbiddenError();
  }
  await assertChangeLimit(ctx, actor);

  return changeRequest(ctx, actor, access, workingPermission(permissions), async (tx, locked) => {
    if (from !== undefined && locked.status !== from) {
      throw new ServiceError('conflict', 'errors.requests.statusChanged');
    }
    if (locked.status === status) {
      return { changed: false, reopened: false, status };
    }
    if (!mayChangeStatus(permissions, locked.status, status)) {
      throw new ServiceError('conflict', 'errors.requests.statusChanged');
    }
    const changed = await recordStatusChange(tx, locked, status, actor, requestSide(permissions));
    await tellPeopleOnRequest(tx, { request: locked, actorId: actor.id }, [
      { event: 'status', entryId: changed },
    ]);
    await tellWebhooks(tx, { requestId: locked.id, typeKey: locked.type }, [
      { event: 'status', entryId: changed },
    ]);
    return { changed: true, reopened: isReopening(locked.status, status), status };
  });
}
