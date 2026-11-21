/**
 * @file Internal notes on a request: what the staff write for each other,
 * which nobody at the company ever reads (decision 0026).
 */
import { requestEntry } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { WRITTEN_TEXT_FORMAT } from '@/lib/requests';
import { requestReplySchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { actingUserId, signedInAsWork } from '../signed-in-as';
import { CHANGE_MOMENT, changeRequest, requestToChange } from './change';
import { storeMentions } from './mentions';
import { subscribeAutomatically } from './subscribers';

/**
 * Adds an internal note to a request's conversation, written by a staff
 * member who works on requests (`mayWriteNote`). Only readers with
 * `requests:view-internal` get it back (`getRequest` leaves out every kind in
 * `STAFF_ONLY_ENTRY_KINDS` for anyone else).
 *
 * A note changes nothing the company sees: not the status, not the first
 * response, and not the request's last activity, which company users see and
 * the lists sort by. It can mention anyone a reply can; someone at the
 * company it mentions never sees it. A note can be added to a done or
 * cancelled request too, as a reply can. It counts towards the same limit as
 * replies: it's a text like one.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.body - The note.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request, `forbidden` without
 *   `requests:manage`, `invalid` when the company is deactivated, `rate_limited` when the
 *   actor has written too often (`RATE_LIMITS.requestRepliesPerUser`).
 * @throws {ZodError} When the note isn't valid.
 */
export default async function addNote(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; body: string },
): Promise<void> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:manage');
  const body = requestReplySchema.parse(input.body);
  await assertRateLimit(
    ctx,
    `request-reply:user:${actingUserId(actor)}`,
    RATE_LIMITS.requestRepliesPerUser,
  );

  await changeRequest(ctx, actor, access, 'requests:manage', async (tx, locked) => {
    const note = firstRow(
      await tx
        .insert(requestEntry)
        .values({
          requestId: locked.id,
          kind: 'note',
          authorId: actor.id,
          authorSide: 'staff',
          ...signedInAsWork(actor),
          body,
          bodyFormat: WRITTEN_TEXT_FORMAT,
          createdAt: CHANGE_MOMENT,
        })
        .returning({ id: requestEntry.id }),
      'the new note',
    );
    // Whoever writes a note follows the request; of the people it mentions, only the staff do.
    await subscribeAutomatically(tx, locked.id, [actor.id]);
    // The people the note mentions, once the note they belong to is there.
    await storeMentions(tx, actor, {
      companyId: locked.companyId,
      requestId: locked.id,
      entryId: note.id,
      written: body,
      staffOnly: true,
    });
  });
}
