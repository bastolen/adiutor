/**
 * @file A video's preview, from a frame its uploader's browser drew
 * (decision 0057): the server can't decode videos, so the browser that
 * chose the file draws one frame and sends it once the upload is done. The
 * frame is the uploader's own claim of what the video shows, like a
 * thumbnail an Office file carries: it's taken once, only for the
 * uploader's own finished upload that no text has claimed yet, and drawn
 * again within the image limits like any other preview.
 */
import { and, eq, isNull } from 'drizzle-orm';

import { requestAttachment } from '@/db/schema';
import { attachmentTypeOf, VIDEO_FRAME_MAX_BYTES } from '@/lib/requests';
import { idSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { notFoundError, ServiceError } from '../errors';
import { drawAndStorePreview } from '../previews';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { actingUserId } from '../signed-in-as';
import { previewKey, StorageError } from '../storage';
import { ownUnsentUploads } from './attachment-claims';
import { attachmentsOn } from './attachments';

/**
 * Sets a video's preview from the frame its uploader's browser drew. Taken
 * only for the actor's own finished upload that no text has claimed yet
 * (`ownUnsentUploads`: with the same staff member signed in as them, if one
 * was, decision 0028), of a video, without a preview yet. The video is
 * claimed first (marked `none`), so it takes one frame however many are
 * sent at once, and is marked `drawn` once the preview is stored, while it
 * isn't removed: a preview of a file removed or purged meanwhile is deleted.
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
  const [row] = await ctx.db
    .select({ name: requestAttachment.name })
    .from(requestAttachment)
    .where(
      and(
        eq(requestAttachment.id, id.data),
        ownUnsentUploads(actor),
        isNull(requestAttachment.preview),
      ),
    );
  if (!row || attachmentTypeOf(row.name)?.preview !== 'video') {
    throw notFoundError();
  }
  // Claimed first: a second frame sent meanwhile finds it taken.
  const claimed = await ctx.db
    .update(requestAttachment)
    .set({ preview: 'none' })
    .where(and(eq(requestAttachment.id, id.data), isNull(requestAttachment.preview)))
    .returning({ id: requestAttachment.id });
  if (claimed.length === 0) {
    throw notFoundError();
  }
  const outcome = await drawAndStorePreview(on.storage, {
    id: id.data,
    kind: 'video',
    bytes: input.frame,
    whenBusy: 'wait',
  });
  if (outcome === 'none') {
    return { preview: false };
  }
  if (outcome !== 'drawn') {
    // Not drawn or not stored: back to without a preview, as it was.
    await ctx.db
      .update(requestAttachment)
      .set({ preview: null })
      .where(and(eq(requestAttachment.id, id.data), eq(requestAttachment.preview, 'none')));
    return { preview: false };
  }
  const kept = await ctx.db
    .update(requestAttachment)
    .set({ preview: 'drawn' })
    .where(and(eq(requestAttachment.id, id.data), isNull(requestAttachment.removedAt)))
    .returning({ id: requestAttachment.id });
  if (kept.length === 0) {
    // Removed or purged while it was drawn: its preview goes too.
    await on.storage.delete(previewKey(id.data)).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- The kind only: the storage's reply may say more.
      console.error(
        'A removed video’s preview could not be deleted:',
        error instanceof StorageError ? error.failure : 'failed',
      );
    });
    return { preview: false };
  }
  return { preview: true };
}
