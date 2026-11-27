/**
 * @file Claiming uploads for a request's text (decision 0044): the files
 * someone uploaded while writing are sent with the text, in the transaction
 * that stores it. Only the uploader's own finished uploads that no text has
 * claimed yet, from the last 24 hours, can be claimed; anything else refuses
 * the whole text, which then stores nothing.
 */
import { and, count, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '@/db';
import { requestAttachment } from '@/db/schema';
import { MAX_ATTACHMENTS_PER_TEXT } from '@/lib/requests';
import { idSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import { ServiceError } from '../errors';
import { signedInAsWork } from '../signed-in-as';

/**
 * How long an upload waits for the text it's sent with, as an SQL interval.
 * The cleanup job purges unsent uploads an hour after this.
 */
const UNSENT_FOR = sql`interval '24 hours'`;

/**
 * The uploads that are an actor's own to send: uploaded by them, by the same
 * staff member signed in as them if one was (so a file uploaded while signed
 * in as someone isn't theirs alone), finished, unsent and no older than 24
 * hours. A video's frame is taken under the same rule (`setVideoFrame`).
 *
 * @param actor - The acting user.
 * @returns The condition on `request_attachment`.
 */
export function ownUnsentUploads(actor: Actor) {
  const work = signedInAsWork(actor);
  return and(
    isNull(requestAttachment.requestId),
    isNotNull(requestAttachment.uploadedAt),
    gt(requestAttachment.createdAt, sql`now() - ${UNSENT_FOR}`),
    eq(requestAttachment.uploadedBy, actor.id),
    eq(requestAttachment.signedInAs, work.signedInAs),
    work.signedInAsStaffId === null
      ? isNull(requestAttachment.signedInAsStaffId)
      : eq(requestAttachment.signedInAsStaffId, work.signedInAsStaffId),
  );
}

/**
 * The refusal for more files on a text than it may have.
 *
 * @returns The error.
 */
function tooManyError(): ServiceError {
  return new ServiceError('invalid', 'errors.attachments.tooMany', {
    maximum: MAX_ATTACHMENTS_PER_TEXT,
  });
}

/**
 * Sends uploads with a text: the request's description (`entryId` `null`),
 * or a reply or note. Call it in the transaction that stores the text, once
 * the text's row is there, after the request's row is locked (attachments
 * come after the request in the lock order). The text's own service has
 * checked that the actor may write it; this checks that each file is theirs
 * to send ({@link ownUnsentUploads}).
 *
 * @param tx - The transaction that stores the text.
 * @param actor - The acting user.
 * @param place - The text the files go with.
 * @param place.requestId - Its request.
 * @param place.entryId - Its entry, or `null` for the description.
 * @param ids - The uploads' IDs, as the form sent them (repeats count once).
 * @returns How many files were sent with it.
 * @throws {ServiceError} `invalid` past `MAX_ATTACHMENTS_PER_TEXT` files on
 *   the text, counting those it has; `conflict` for a file that can't be
 *   sent (gone, expired, sent already, or not the actor's), named when it's
 *   one of the actor's own.
 */
export default async function claimAttachments(
  tx: DatabaseTransaction,
  actor: Actor,
  place: { requestId: string; entryId: string | null },
  ids: readonly string[],
): Promise<number> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) {
    return 0;
  }
  if (wanted.length > MAX_ATTACHMENTS_PER_TEXT) {
    throw tooManyError();
  }
  if (!wanted.every((id) => idSchema.safeParse(id).success)) {
    throw new ServiceError('conflict', 'errors.attachments.someUnavailable');
  }
  const ofText = and(
    eq(requestAttachment.requestId, place.requestId),
    place.entryId === null
      ? isNull(requestAttachment.entryId)
      : eq(requestAttachment.entryId, place.entryId),
    isNull(requestAttachment.removedAt),
  );
  const [had] = await tx.select({ files: count() }).from(requestAttachment).where(ofText);
  if ((had?.files ?? 0) + wanted.length > MAX_ATTACHMENTS_PER_TEXT) {
    throw tooManyError();
  }

  const claimed = await tx
    .update(requestAttachment)
    .set({ requestId: place.requestId, entryId: place.entryId })
    .where(and(inArray(requestAttachment.id, wanted), ownUnsentUploads(actor)))
    .returning({ id: requestAttachment.id });
  if (claimed.length === wanted.length) {
    return claimed.length;
  }
  const sent = new Set(claimed.map((row) => row.id));
  // Named only when it's the actor's own upload, so nothing tells of someone else's file.
  const [own] = await tx
    .select({ name: requestAttachment.name })
    .from(requestAttachment)
    .where(
      and(
        inArray(
          requestAttachment.id,
          wanted.filter((id) => !sent.has(id)),
        ),
        eq(requestAttachment.uploadedBy, actor.id),
      ),
    )
    .limit(1);
  throw own
    ? new ServiceError('conflict', 'errors.attachments.unavailable', { name: own.name })
    : new ServiceError('conflict', 'errors.attachments.someUnavailable');
}
