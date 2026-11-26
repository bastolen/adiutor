/**
 * @file Replying to a request: the conversation between a company and the
 * staff.
 */
import { eq } from 'drizzle-orm';

import { request, requestEntry } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { appUrl } from '@/lib/env';
import {
  maySetStatus,
  mayReplyWithStatus,
  requestSide,
  statusAfterReply,
  WRITTEN_TEXT_FORMAT,
} from '@/lib/requests';
import type { RequestStatus } from '@/lib/requests';
import { requestReplySchema, requestStatusSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { forbiddenError } from '../errors';
import { signedInAsWork } from '../signed-in-as';
import {
  assertReplyLimit,
  CHANGE_MOMENT,
  changeRequest,
  recordStatusChange,
  requestToChange,
  workingPermission,
} from './change';
import { storeMentions } from './mentions';
import withoutStaffPageLinks from './staff-links';
import { subscribeAutomatically } from './subscribers';
import { tellWebhooks } from './tell-webhooks';
import { tellPeopleOnRequest } from './updates';

/**
 * Replies to a request, and may set its status with the reply: the staff
 * ask the company something and wait for its answer ("waiting").
 *
 * Without a status, a reply from the company to a request that was waiting
 * for it puts the request back in progress. No such reply reopens a request
 * that is done or cancelled, and neither does one sent to wait for the
 * company: whether a reply sets the status asked for is `mayReplyWithStatus`,
 * the rules the request page offers its buttons by.
 *
 * Everyone else on the request is told by email (`tellPeopleOnRequest`).
 * The reply is stored without links to the staff's pages
 * (`withoutStaffPageLinks`): the company reads it. A reply to an internal
 * request keeps them, since only the staff read it, and is never sent as a
 * solution: nobody could approve it (decision 0048).
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:contribute` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.body - The reply.
 * @param input.status - A status to set with it (`REQUEST_STATUSES`); empty to leave that to the reply.
 * @returns The request's status after the reply.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request, `forbidden` without
 *   `requests:contribute`, when the status isn't theirs to set, or for a solution on an
 *   internal request, `invalid` when the company is
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
  const place = access.company === null ? 'internal' : 'company';
  const written = requestReplySchema.parse(input.body);
  const asked = input.status ? requestStatusSchema.parse(input.status) : null;
  if (asked && !maySetStatus(permissions, asked, place)) {
    throw forbiddenError();
  }
  await assertReplyLimit(ctx, actor);
  // The company reads it: a link to one of the staff's pages is kept as its text. Past the limit,
  // as reading the text costs time. Only the staff read an internal request, which keeps them.
  const body = place === 'internal' ? written : withoutStaffPageLinks(written, appUrl);

  const side = requestSide(permissions);
  return changeRequest(ctx, actor, access, workingPermission(permissions), async (tx, locked) => {
    const entry = {
      requestId: locked.id,
      authorId: actor.id,
      authorSide: side,
      ...signedInAsWork(actor),
      createdAt: CHANGE_MOMENT,
    };
    const reply = firstRow(
      await tx
        .insert(requestEntry)
        .values({ ...entry, kind: 'comment', body, bodyFormat: WRITTEN_TEXT_FORMAT })
        .returning({ id: requestEntry.id }),
      'the new reply',
    );
    // Whoever replies follows the request from then on, and so do the people the reply mentions.
    await subscribeAutomatically(tx, locked.id, [actor.id]);
    // The people the reply mentions, once the reply they belong to is there.
    const mentioned = await storeMentions(tx, actor, {
      companyId: locked.companyId,
      requestId: locked.id,
      entryId: reply.id,
      written: body,
    });
    // A status the request can't move to as it is by now is left alone: the reply still counts. A
    // reply sent as the solution makes it wait for the company's approval (decision 0033).
    const allowed = asked !== null && mayReplyWithStatus(permissions, locked.status, asked, place);
    const status = asked && allowed ? asked : statusAfterReply(side, locked.status);
    const told = { request: locked, actorId: actor.id };
    if (status === locked.status) {
      await tx
        .update(request)
        .set({ lastActivityAt: CHANGE_MOMENT })
        .where(eq(request.id, locked.id));
      await tellPeopleOnRequest(tx, told, [{ event: 'reply', entryId: reply.id }], mentioned);
      await tellWebhooks(tx, { requestId: locked.id, typeKey: locked.type }, [
        { event: 'reply', entryId: reply.id },
      ]);
      return { status };
    }
    // After the reply, so the history reads: the reply, then what it did to the status.
    const changed = await recordStatusChange(tx, locked, status, actor, side);
    // The people on the request hear of both, in one email.
    await tellPeopleOnRequest(
      tx,
      told,
      [
        { event: 'reply', entryId: reply.id },
        { event: 'status', entryId: changed },
      ],
      mentioned,
    );
    await tellWebhooks(tx, { requestId: locked.id, typeKey: locked.type }, [
      { event: 'reply', entryId: reply.id },
      { event: 'status', entryId: changed },
    ]);
    return { status };
  });
}
