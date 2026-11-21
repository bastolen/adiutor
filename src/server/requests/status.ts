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
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { actingUserId } from '../signed-in-as';
import { changeRequest, recordStatusChange, requestToChange, workingPermission } from './change';
import { tellPeopleOnRequest } from './updates';

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
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the request's company, and
 *   `requests:manage` for the statuses only the staff set.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.status - The new status (`REQUEST_STATUSES`).
 * @returns Whether anything changed, whether that reopened the request, and its status.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request, `forbidden` without
 *   `requests:contribute` or when the status isn't theirs to set, `invalid` when the company is
 *   deactivated, `rate_limited` when the actor has changed requests too often
 *   (`RATE_LIMITS.requestChangesPerUser`), `conflict` when the request's status changed
 *   meanwhile to one this change can't follow (reopening a request that's open again).
 * @throws {ZodError} When the status isn't one.
 */
export default async function changeRequestStatus(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; status: string },
): Promise<{ changed: boolean; reopened: boolean; status: RequestStatus }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:contribute');
  const { permissions } = access;
  const status = requestStatusSchema.parse(input.status);
  // Waiting for approval comes only with the reply that holds the solution (`replyToRequest`).
  if (status === 'proposed' || !maySetStatus(permissions, status)) {
    throw forbiddenError();
  }
  await assertRateLimit(
    ctx,
    `request-change:user:${actingUserId(actor)}`,
    RATE_LIMITS.requestChangesPerUser,
  );

  return changeRequest(ctx, actor, access, workingPermission(permissions), async (tx, locked) => {
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
    return { changed: true, reopened: isReopening(locked.status, status), status };
  });
}
