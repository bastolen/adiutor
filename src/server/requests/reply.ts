/**
 * @file Replying to a request: the conversation between a company and the
 * staff.
 */
import { eq } from 'drizzle-orm';

import { request, requestEntry } from '@/db/schema';
import { maySetStatus, mayChangeStatus, requestSide, statusAfterReply } from '@/lib/requests';
import type { RequestStatus } from '@/lib/requests';
import { requestReplySchema, requestStatusSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { forbiddenError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import {
  CHANGE_MOMENT,
  changeRequest,
  requestToChange,
  statusChange,
  workingPermission,
} from './change';

/**
 * Replies to a request, and may set its status with the reply: the staff
 * ask the company something and wait for its answer ("waiting").
 *
 * Without a status, a reply from the company to a request that was waiting
 * for it puts the request back in progress. No reply reopens a request that
 * is done or cancelled.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.body - The reply.
 * @param input.status - A status to set with it (`REQUEST_STATUSES`); empty to leave that to the reply.
 * @returns The request's status after the reply.
 * @throws {ServiceError} `signed_in_as` while a staff member is signed in as the actor,
 *   `not_found` when the actor may not see the request, `forbidden` without
 *   `requests:contribute` or when the status isn't theirs to set, `invalid` when the company is
 *   deactivated, `rate_limited` when the actor has replied too often
 *   (`RATE_LIMITS.requestRepliesPerUser`).
 * @throws {ZodError} When the reply or the status isn't valid.
 */
export default async function replyToRequest(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; body: string; status?: string },
): Promise<{ status: RequestStatus }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:contribute');
  const { permissions } = access;
  const body = requestReplySchema.parse(input.body);
  const asked = input.status ? requestStatusSchema.parse(input.status) : null;
  if (asked && !maySetStatus(permissions, asked)) {
    throw forbiddenError();
  }
  await assertRateLimit(ctx, `request-reply:user:${actor.id}`, RATE_LIMITS.requestRepliesPerUser);

  const side = requestSide(permissions);
  return changeRequest(ctx, actor, access, workingPermission(permissions), async (tx, locked) => {
    const entry = {
      requestId: locked.id,
      authorId: actor.id,
      authorSide: side,
      createdAt: CHANGE_MOMENT,
    };
    await tx.insert(requestEntry).values({ ...entry, kind: 'comment', body });
    // A status the request can't move to as it is by now is left alone: the reply still counts.
    const status =
      asked && mayChangeStatus(permissions, locked.status, asked)
        ? asked
        : statusAfterReply(side, locked.status);
    if (status === locked.status) {
      await tx
        .update(request)
        .set({ lastActivityAt: CHANGE_MOMENT })
        .where(eq(request.id, locked.id));
      return { status };
    }
    // After the reply, so the history reads: the reply, then what it did to the status.
    await tx
      .insert(requestEntry)
      .values({ ...entry, kind: 'status', fromValue: locked.status, toValue: status });
    await tx
      .update(request)
      .set(statusChange(locked.status, status))
      .where(eq(request.id, locked.id));
    return { status };
  });
}
