/**
 * @file Integration tests for the job that draws the previews uploads
 * didn't: sent files whose kind has a preview and that have none yet,
 * newest first; a file it can't draw marked so and never tried again; a
 * file put back when the storage fails, ending the run with a failure that
 * says so; nothing past its
 * deadline, without a storage, or in a folder that isn't set up.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestAttachment } from '@/db/schema';

import { simplePdf } from '../../../../tests/files/pdfs';
import {
  createCompany,
  createStaffSettings,
  memberActor,
  minutesAgo,
  setupTestContext,
  storeAttachment,
  storeRequest,
} from '../../../../tests/integration/helpers';
import {
  attachmentKey,
  type FileStorage,
  pageKey,
  previewKey,
  StorageError,
  storageFor,
} from '../../storage';
import attachmentPreviews from './attachment-previews';

/** Kinds of preview whose drawing won't start, as when a library won't load. */
const unavailable = vi.hoisted(() => new Set<string>());

vi.mock('../../previews', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../previews')>();
  return {
    ...original,
    /**
     * Draws as the real one does, except for the kinds the test made unavailable.
     *
     * @param args - The storage, and the file.
     * @returns How it went.
     */
    drawAndStorePreview: (...args: Parameters<typeof original.drawAndStorePreview>) =>
      unavailable.has(args[1].kind)
        ? Promise.resolve('skipped' as const)
        : original.drawAndStorePreview(...args),
  };
});

const { ctx, db, storage } = setupTestContext();

/** Someone at a company, and a request of theirs. */
let uploader: string;
let requestId: string;

/** A screenshot, as its bytes. */
let png: Uint8Array<ArrayBuffer>;

beforeEach(async () => {
  unavailable.clear();
  await createStaffSettings(db);
  const company = await createCompany(db);
  uploader = (await memberActor(db, company.id, 'client')).id;
  requestId = (await storeRequest(db, company.id)).id;
  png = new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#336699' } })
      .png()
      .toBuffer(),
  );
});

/**
 * Runs the job.
 *
 * @param context - The service context; the test's own unless given.
 * @param seconds - How long it may start new work for.
 * @returns Its summary.
 */
async function run(context = ctx, seconds = 30) {
  return attachmentPreviews.run(context, { deadline: new Date(Date.now() + seconds * 1000) });
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

/**
 * A sent screenshot without a preview.
 *
 * @param values - What differs.
 * @returns Its ID.
 */
function screenshot(values: Parameters<typeof storeAttachment>[2] = {}) {
  return storeAttachment(db, storage, {
    uploadedBy: uploader,
    requestId,
    name: 'screenshot.png',
    contentType: 'image/png',
    bytes: png,
    ...values,
  });
}

describe('attachment-previews', () => {
  it('draws the previews of sent files that have none, and leaves every other file alone', async () => {
    const older = await screenshot({ createdAt: minutesAgo(60) });
    const newer = await screenshot();
    const log = await storeAttachment(db, storage, { uploadedBy: uploader, requestId });
    const unsent = await screenshot({ requestId: null });
    const drawn = await screenshot({ preview: 'drawn' });

    expect(await run()).toEqual({ summary: { previews: 2, withoutPreview: 1 } });

    expect(await previewOf(older)).toBe('drawn');
    expect(await previewOf(newer)).toBe('drawn');
    const stored = await storage.get(previewKey(newer));
    const preview = new Uint8Array(await new Response(stored?.body).arrayBuffer());
    expect(await sharp(preview).metadata()).toMatchObject({ format: 'webp', width: 480 });
    // A log has no preview to draw, an unsent file waits for its text, one drawn stays drawn.
    expect(await previewOf(log)).toBe('none');
    expect(await previewOf(unsent)).toBeNull();
    expect(await previewOf(drawn)).toBe('drawn');
    expect(await run()).toEqual({ summary: { previews: 0, withoutPreview: 0 } });
  });

  it('draws a PDF’s large page with its preview', async () => {
    const pdf = await screenshot({
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      bytes: simplePdf(),
    });

    expect(await run()).toEqual({ summary: { previews: 1, withoutPreview: 0 } });
    expect(await previewOf(pdf)).toBe('drawn');
    expect(await storage.get(pageKey(pdf))).not.toBeNull();
  });

  it('deletes the preview of a file removed while it was drawn', async () => {
    const id = await screenshot();
    const removing: FileStorage = {
      ...storage,
      /**
       * Stores as the storage does, while a staff member removes the file just as its preview is
       * stored.
       *
       * @param key - Where.
       * @param bytes - What.
       * @param contentType - Its type.
       */
      put: async (key, bytes, contentType) => {
        await storage.put(key, bytes, contentType);
        if (key === previewKey(id)) {
          await db
            .update(requestAttachment)
            .set({ removedAt: new Date(), fileDeletedAt: new Date() })
            .where(eq(requestAttachment.id, id));
        }
      },
      /**
       * Runs the calls on this storage.
       *
       * @param work - The calls.
       * @returns What they return.
       */
      session: (work) => work(removing),
    };

    const summary = await run({
      ...ctx,
      /**
       * The storage that removes the file meanwhile.
       *
       * @returns It.
       */
      storage: async () => removing,
    });

    expect(summary).toEqual({ summary: { previews: 0, withoutPreview: 0 } });
    expect(await storage.get(previewKey(id))).toBeNull();
    expect(await previewOf(id)).toBe('none');
  });

  it('draws other kinds while one kind’s drawing won’t start, and leaves that kind for later', async () => {
    const older = await screenshot({ createdAt: minutesAgo(5) });
    const pdf = await screenshot({ name: 'invoice.pdf', contentType: 'application/pdf' });
    unavailable.add('pdf');

    expect(await run()).toEqual({
      summary: { previews: 1, withoutPreview: 0 },
      failure: 'Previews of kind pdf could not be drawn; the next run tries again',
    });
    expect(await previewOf(pdf)).toBeNull();
    expect(await previewOf(older)).toBe('drawn');
  });

  it('marks a file it can’t draw, or one missing from the storage, and never tries again', async () => {
    const broken = await screenshot({ bytes: png.slice(0, 100) });
    const missing = await screenshot();
    await storage.delete(attachmentKey(missing));

    expect(await run()).toEqual({ summary: { previews: 0, withoutPreview: 2 } });
    expect(await previewOf(broken)).toBe('none');
    expect(await previewOf(missing)).toBe('none');
    expect(await run()).toEqual({ summary: { previews: 0, withoutPreview: 0 } });
  });

  it('puts a file back and ends the run when the storage fails', async () => {
    const first = await screenshot({ createdAt: minutesAgo(5) });
    const second = await screenshot();
    const failing: FileStorage = {
      ...storage,
      /**
       * Fails as an unreachable storage does.
       *
       * @returns Never.
       */
      get: async () => {
        throw new StorageError('unreachable');
      },
      /**
       * Runs the calls on this failing storage.
       *
       * @param work - The calls.
       * @returns What they return.
       */
      session: (work) => work(failing),
    };

    const summary = await run({
      ...ctx,
      /**
       * The failing storage.
       *
       * @returns It.
       */
      storage: async () => failing,
    });

    expect(summary).toEqual({
      summary: { previews: 0, withoutPreview: 0 },
      failure: 'The storage failed (unreachable); the next run tries again',
    });
    expect(await previewOf(second)).toBeNull();
    expect(await previewOf(first)).toBeNull();
    // The next run draws them.
    expect(await run()).toEqual({ summary: { previews: 2, withoutPreview: 0 } });
  });

  it('starts nothing past its deadline', async () => {
    const id = await screenshot();
    expect(await run(ctx, -1)).toEqual({ summary: { previews: 0, withoutPreview: 0 } });
    expect(await previewOf(id)).toBeNull();
  });

  it('does nothing without a storage, or in a folder that isn’t set up as Adiutor’s', async () => {
    const id = await screenshot();
    expect(
      await run({
        ...ctx,
        /**
         * No storage chosen.
         *
         * @returns None.
         */
        storage: async () => null,
      }),
    ).toEqual({ summary: { previews: 0, withoutPreview: 0 } });
    const empty = await mkdtemp(join(tmpdir(), 'adiutor-unmarked-'));
    try {
      const unmarked = storageFor({ driver: 'local', dir: empty });
      expect(
        await run({
          ...ctx,
          /**
           * The folder without its marker.
           *
           * @returns Its storage.
           */
          storage: async () => unmarked,
        }),
      ).toEqual({ summary: { previews: 0, withoutPreview: 0 } });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
    expect(await previewOf(id)).toBeNull();
  });
});
