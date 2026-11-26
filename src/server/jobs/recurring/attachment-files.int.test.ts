/**
 * @file Integration tests for the job that purges unsent attachments: after
 * 25 hours, once the uploader's account is gone, and unfinished uploads
 * after an hour; a sent file, or one uploaded lately, stays; the files of
 * removed attachments that are still in storage are deleted; nothing
 * happens without a storage.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { requestAttachment } from '@/db/schema';

import {
  createCompany,
  createStaffSettings,
  createUser,
  memberActor,
  minutesAgo,
  setupTestContext,
  storeAttachment,
  storeRequest,
} from '../../../../tests/integration/helpers';
import { attachmentKey } from '../../storage';
import attachmentFiles from './attachment-files';

const { ctx, db, storage } = setupTestContext();

/** Someone at a company. */
let uploader: string;

/** A request of that company. */
let requestId: string;

beforeEach(async () => {
  await createStaffSettings(db);
  const company = await createCompany(db);
  uploader = (await memberActor(db, company.id, 'client')).id;
  requestId = (await storeRequest(db, company.id)).id;
});

/**
 * A storage that isn't there: none is chosen.
 *
 * @returns Nothing.
 */
async function noStorage() {
  return null;
}

/**
 * Runs the job with time to spare.
 *
 * @param context - The service context; the test's own unless given.
 * @returns Its summary.
 */
async function run(context = ctx) {
  return attachmentFiles.run(context, { deadline: new Date(Date.now() + 30_000) });
}

/**
 * The IDs of the attachments left.
 *
 * @returns Their IDs.
 */
async function left(): Promise<string[]> {
  return (await db.select({ id: requestAttachment.id }).from(requestAttachment)).map(
    (row) => row.id,
  );
}

describe('attachment-files', () => {
  it('purges unsent files after 25 hours, and unfinished uploads after an hour, file and row', async () => {
    const old = await storeAttachment(db, storage, {
      uploadedBy: uploader,
      createdAt: minutesAgo(26 * 60),
    });
    const unfinished = await storeAttachment(db, storage, {
      uploadedBy: uploader,
      createdAt: minutesAgo(61),
      uploadedAt: null,
    });
    const recent = await storeAttachment(db, storage, {
      uploadedBy: uploader,
      createdAt: minutesAgo(23 * 60),
    });
    const uploading = await storeAttachment(db, storage, {
      uploadedBy: uploader,
      createdAt: minutesAgo(5),
      uploadedAt: null,
    });
    const sent = await storeAttachment(db, storage, {
      uploadedBy: uploader,
      requestId,
      createdAt: minutesAgo(30 * 24 * 60),
    });

    expect(await run()).toEqual({ summary: { unsentFiles: 2, removedFiles: 0 } });

    expect((await left()).sort()).toEqual([recent, uploading, sent].sort());
    expect(await storage.get(attachmentKey(old))).toBeNull();
    expect(await storage.get(attachmentKey(unfinished))).toBeNull();
    expect(await storage.get(attachmentKey(recent))).not.toBeNull();
    expect(await storage.get(attachmentKey(sent))).not.toBeNull();
  });

  it('purges an unsent file at once when its uploader’s account is gone', async () => {
    const gone = await createUser(db, 'gone@adiutor.test');
    const orphan = await storeAttachment(db, storage, { uploadedBy: null });
    await storeAttachment(db, storage, { uploadedBy: gone });

    expect(await run()).toEqual({ summary: { unsentFiles: 1, removedFiles: 0 } });
    expect(await left()).not.toContain(orphan);
  });

  it('deletes the files of removed attachments still in storage, and notes they’re gone', async () => {
    const removed = await storeAttachment(db, storage, { uploadedBy: uploader, requestId });
    const deletedAlready = await storeAttachment(db, storage, { uploadedBy: uploader, requestId });
    await db
      .update(requestAttachment)
      .set({ removedAt: minutesAgo(5) })
      .where(eq(requestAttachment.id, removed));
    await db
      .update(requestAttachment)
      .set({ removedAt: minutesAgo(5), fileDeletedAt: minutesAgo(5) })
      .where(eq(requestAttachment.id, deletedAlready));

    expect(await run()).toEqual({ summary: { unsentFiles: 0, removedFiles: 1 } });

    expect(await storage.get(attachmentKey(removed))).toBeNull();
    const [row] = await db
      .select({ fileDeletedAt: requestAttachment.fileDeletedAt })
      .from(requestAttachment)
      .where(eq(requestAttachment.id, removed));
    expect(row?.fileDeletedAt).toBeInstanceOf(Date);
    // Its row stays: it's the mark that says who removed it.
    expect(await left()).toContain(removed);
    expect(await run()).toEqual({ summary: { unsentFiles: 0, removedFiles: 0 } });
  });

  it('does nothing while no storage is chosen', async () => {
    await storeAttachment(db, storage, { uploadedBy: uploader, createdAt: minutesAgo(26 * 60) });
    expect(await run({ ...ctx, storage: noStorage })).toEqual({
      summary: { unsentFiles: 0, removedFiles: 0 },
    });
    expect(await left()).toHaveLength(1);
  });
});
