/**
 * @file A video's preview, from a frame its uploader's browser drew
 * (decision 0057): the server can't decode videos, so the browser that
 * chose the file draws one frame and sends it once the upload is done. The
 * frame is the uploader's own claim of what the video shows, like a
 * thumbnail an Office file carries: it's taken once, only for the
 * uploader's own finished upload that no text has claimed yet, and drawn
 * again within the image limits like any other preview.
 */
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';

import { requestAttachment } from '@/db/schema';
import { attachmentTypeOf, VIDEO_FRAME_MAX_BYTES } from '@/lib/requests';
import { idSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { notFoundError, ServiceError } from '../errors';
import { drawAndStorePreview } from '../previews';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { actingUserId, signedInAsWork } from '../signed-in-as';
import { attachmentsOn } from './attachments';

/** How long an upload waits for the text it's sent with, as `claimAttachments` counts it. */
const UNSENT_FOR = sql`interval '24 hours'`;

/**
 * Sets a video's preview from the frame its uploader's browser drew. Taken
 * only for the actor's own finished upload that no text has claimed yet
 * (with the same staff member signed in as them, if one was: request work,
 * decision 0028), of a video, without a preview yet; each video takes one
 * frame.
 *
 * @param ctx - Service context.
 * @param actor - The acting user: the uploader.
 * @param input - The frame.
 * @param input.attachment - The video's ID.
 * @param input.frame - The frame: a JPEG, PNG or WebP image.
 * @returns Whether the preview was drawn.
 * @throws {ServiceError} `conflict` while attaching is off, `not_found` for anything but the
 *   actor's own unsent video without a preview, `invalid` for a frame that's too large,
 *   `rate_limited` past `RATE_LIMITS.videoFramesPerUser`.
 */
export default async function setVideoFrame(
  ctx: ServiceContext,
  actor: Actor,
  input: { attachment: string; frame: Uint8Array },
): Promise<{ preview: boolean }> {
  const on = await attachmentsOn(ctx);
  if (!on) {
    throw new ServiceError('conflict', 'errors.attachments.off');
  }
  const id = idSchema.safeParse(input.attachment);
  if (!id.success) {
    throw notFoundError();
  }
  if (input.frame.byteLength === 0 || input.frame.byteLength > VIDEO_FRAME_MAX_BYTES) {
    throw new ServiceError('invalid', 'errors.attachments.notItsType');
  }
  await assertRateLimit(
    ctx,
    `video-frame:user:${actingUserId(actor)}`,
    RATE_LIMITS.videoFramesPerUser,
  );
  const work = signedInAsWork(actor);
  const yours = and(
    eq(requestAttachment.id, id.data),
    isNull(requestAttachment.requestId),
    isNotNull(requestAttachment.uploadedAt),
    gt(requestAttachment.createdAt, sql`now() - ${UNSENT_FOR}`),
    eq(requestAttachment.uploadedBy, actor.id),
    eq(requestAttachment.signedInAs, work.signedInAs),
    work.signedInAsStaffId === null
      ? isNull(requestAttachment.signedInAsStaffId)
      : eq(requestAttachment.signedInAsStaffId, work.signedInAsStaffId),
    isNull(requestAttachment.preview),
  );
  const [row] = await ctx.db
    .select({ name: requestAttachment.name })
    .from(requestAttachment)
    .where(yours);
  if (!row || attachmentTypeOf(row.name)?.preview !== 'video') {
    throw notFoundError();
  }
  const state = await drawAndStorePreview(on.storage, {
    id: id.data,
    kind: 'video',
    bytes: input.frame,
    whenBusy: 'wait',
  });
  if (state === null) {
    return { preview: false };
  }
  // Once: a second frame for the same video, sent meanwhile, finds its preview set.
  const set = await ctx.db
    .update(requestAttachment)
    .set({ preview: state })
    .where(and(eq(requestAttachment.id, id.data), isNull(requestAttachment.preview)))
    .returning({ id: requestAttachment.id });
  return { preview: state === 'drawn' && set.length > 0 };
}
