/**
 * @file Integration tests for a video's preview from the frame its
 * uploader's browser drew: taken once, for the uploader's own unsent video
 * (with the same staff member signed in as them, if one was), drawn again
 * within the limits, one frame however many are sent at once, and deleted
 * when the video is purged meanwhile; refused for anyone else's upload, a sent one, a file
 * that isn't a video, a frame too large, while attaching is off and past the
 * rate limit.
 */
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';

import { requestAttachment } from '@/db/schema';

import {
  createCompany,
  createStaffSettings,
  fillRateLimitBucket,
  memberActor,
  saveSettings,
  staffActor,
  storeAttachment,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { RATE_LIMITS } from '../rate-limit';
import { type FileStorage, previewKey } from '../storage';
import setVideoFrame from './attachment-frames';
import { ctx, db, storage, storeRequest } from './test-helpers';

/** Someone at a company, who uploads a video. */
let client: Actor;

/** A frame, as a browser draws one. */
let frame: Uint8Array;

beforeEach(async () => {
  await createStaffSettings(db);
  await saveSettings(db, { 'attachments.enabled': true });
  client = await memberActor(db, (await createCompany(db)).id, 'client');
  frame = new Uint8Array(
    await sharp({ create: { width: 640, height: 360, channels: 3, background: '#223344' } })
      .jpeg()
      .toBuffer(),
  );
});

/**
 * A video someone uploaded, not sent yet.
 *
 * @param values - What differs.
 * @returns Its ID.
 */
function video(values: Parameters<typeof storeAttachment>[2] = {}) {
  return storeAttachment(db, storage, {
    uploadedBy: client.id,
    name: 'demo.webm',
    contentType: 'video/webm',
    bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
    ...values,
  });
}

/**
 * The service error a call fails with.
 *
 * @param work - The call.
 * @returns The error.
 */
async function refusal(work: () => Promise<unknown>): Promise<ServiceError> {
  const error = await work().then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof ServiceError)) {
    throw new Error(`Expected a service error, got ${String(error)}.`);
  }
  return error;
}

/**
 * Where a file's preview stands.
 *
 * @param id - The file.
 * @returns Its `preview` column.
 */
async function previewOf(id: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ preview: requestAttachment.preview })
    .from(requestAttachment)
    .where(eq(requestAttachment.id, id));
  return row?.preview;
}

describe('setVideoFrame', () => {
  it('takes the uploader’s frame once, drawn again as the video’s preview', async () => {
    const id = await video();

    expect(await setVideoFrame(ctx, client, { attachment: id, frame })).toEqual({ preview: true });

    expect(await previewOf(id)).toBe('drawn');
    const stored = await storage.get(previewKey(id));
    const preview = new Uint8Array(await new Response(stored?.body).arrayBuffer());
    expect(await sharp(preview).metadata()).toMatchObject({ format: 'webp', width: 480 });
    // One frame a video.
    expect((await refusal(() => setVideoFrame(ctx, client, { attachment: id, frame }))).code).toBe(
      'not_found',
    );
  });

  it('takes one frame when two are sent at once', async () => {
    const id = await video();
    const results = await Promise.allSettled([
      setVideoFrame(ctx, client, { attachment: id, frame }),
      setVideoFrame(ctx, client, { attachment: id, frame }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toEqual([
      { status: 'fulfilled', value: { preview: true } },
    ]);
    expect(await previewOf(id)).toBe('drawn');
  });

  it('deletes the preview of a video purged while its frame was drawn', async () => {
    const id = await video();
    const purging: FileStorage = {
      ...storage,
      /**
       * Stores as the storage does, while the cleanup job purges the video just as its preview
       * is stored.
       *
       * @param key - Where.
       * @param bytes - What.
       * @param contentType - Its type.
       */
      put: async (key, bytes, contentType) => {
        await storage.put(key, bytes, contentType);
        if (key === previewKey(id)) {
          await db.delete(requestAttachment).where(eq(requestAttachment.id, id));
        }
      },
    };
    const purgingCtx: ServiceContext = {
      ...ctx,
      /**
       * The storage that purges the video meanwhile.
       *
       * @returns It.
       */
      storage: async () => purging,
    };

    expect(await setVideoFrame(purgingCtx, client, { attachment: id, frame })).toEqual({
      preview: false,
    });
    expect(await storage.get(previewKey(id))).toBeNull();
  });

  it('marks a frame that isn’t an image, and takes no other', async () => {
    const id = await video();
    const notAnImage = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await setVideoFrame(ctx, client, { attachment: id, frame: notAnImage })).toEqual({
      preview: false,
    });
    expect(await previewOf(id)).toBe('none');
  });

  it('takes a frame only for the uploader’s own unsent video', async () => {
    const company = await createCompany(db, { name: 'Adiutor Tests B' });
    const requestId = (await storeRequest(company.id)).id;
    const someoneElse = await memberActor(db, company.id, 'client');
    const sent = await video({ requestId });
    const image = await video({ name: 'photo.png', contentType: 'image/png' });
    const theirs = await video({ uploadedBy: someoneElse.id });
    const asked = { actor: client, frame };
    const refusals = await Promise.all(
      [sent, image, theirs, 'not-an-id'].map((attachment) =>
        refusal(() => setVideoFrame(ctx, asked.actor, { attachment, frame: asked.frame })),
      ),
    );
    expect(refusals.map((error) => error.code)).toEqual([
      'not_found',
      'not_found',
      'not_found',
      'not_found',
    ]);
  });

  it('takes a frame sent while signed in as the uploader only from that staff member', async () => {
    const support = await staffActor(db, 'support');
    const asClient: Actor = {
      ...client,
      signedInAs: {
        staffId: support.id,
        staffName: support.name,
        endsAt: new Date(Date.now() + 30 * 60_000),
        returnTo: '/dashboard',
        staffPermissions: ['users:view'],
      },
    };
    const id = await video({ signedInAsStaffId: support.id });

    expect((await refusal(() => setVideoFrame(ctx, client, { attachment: id, frame }))).code).toBe(
      'not_found',
    );
    expect(await setVideoFrame(ctx, asClient, { attachment: id, frame })).toEqual({
      preview: true,
    });
  });

  it('refuses a frame too large, while attaching is off, and past the rate limit', async () => {
    const id = await video();
    const tooLarge = new Uint8Array(512 * 1024 + 1);
    expect(
      (await refusal(() => setVideoFrame(ctx, client, { attachment: id, frame: tooLarge }))).code,
    ).toBe('invalid');

    await saveSettings(db, { 'attachments.enabled': false });
    expect((await refusal(() => setVideoFrame(ctx, client, { attachment: id, frame }))).code).toBe(
      'conflict',
    );

    await saveSettings(db, { 'attachments.enabled': true });
    await fillRateLimitBucket(
      db,
      `video-frame:user:${client.id}`,
      RATE_LIMITS.videoFramesPerUser.limit,
    );
    expect((await refusal(() => setVideoFrame(ctx, client, { attachment: id, frame }))).code).toBe(
      'rate_limited',
    );
  });
});
