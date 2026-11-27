/**
 * @file Integration tests for reading a request's attachments: each text
 * with its own files, a note's files only for the staff, unsent files for
 * nobody, a removed file as who removed it; the list of every file on the
 * request, in the page's order; and downloading one, or its
 * preview, for whoever may read its text and nobody else, checked before the
 * storage is read.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { company, requestAttachment } from '@/db/schema';

import {
  createCompany,
  createStaffSettings,
  memberActor,
  staffActor,
  storeAttachment,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { attachmentKey, previewKey } from '../storage';
import { setActivityView } from './activity-view';
import { loadAttachment } from './attachments';
import { getRequest } from './detail';
import { ctx, db, storage, storeEntry, storeRequest } from './test-helpers';

/** The request's company, its client, a staff member who works on requests, and Finance. */
let companyId: string;
let client: Actor;
let support: Actor;
let finance: Actor;

/** The request, and its reply and note. */
let requestId: string;
let number: string;
let replyId: string;
let noteId: string;

/** A file of each text, an unsent one, and a removed one. */
const files: Record<'description' | 'reply' | 'note' | 'unsent' | 'removed', string> = {
  description: '',
  reply: '',
  note: '',
  unsent: '',
  removed: '',
};

beforeEach(async () => {
  await createStaffSettings(db);
  companyId = (await createCompany(db)).id;
  client = await memberActor(db, companyId, 'client');
  support = await staffActor(db, 'support');
  finance = await staffActor(db, 'finance');
  const stored = await storeRequest(companyId, { createdBy: client.id });
  requestId = stored.id;
  number = String(stored.number);
  replyId = (await storeEntry(requestId, { authorId: client.id })).id;
  noteId = (await storeEntry(requestId, { kind: 'note', authorSide: 'staff', body: 'Toner?' })).id;
  files.description = await storeAttachment(db, storage, {
    requestId,
    uploadedBy: client.id,
    name: 'screenshot.png',
    contentType: 'image/png',
    preview: 'drawn',
  });
  files.reply = await storeAttachment(db, storage, {
    requestId,
    entryId: replyId,
    uploadedBy: client.id,
    name: 'printer.log',
  });
  files.note = await storeAttachment(db, storage, {
    requestId,
    entryId: noteId,
    uploadedBy: support.id,
    name: 'driver notes.txt',
    preview: 'drawn',
  });
  files.unsent = await storeAttachment(db, storage, { uploadedBy: client.id });
  files.removed = await storeAttachment(db, storage, {
    requestId,
    entryId: replyId,
    uploadedBy: client.id,
    name: 'password.png',
    contentType: 'image/png',
    preview: 'drawn',
  });
  await db
    .update(requestAttachment)
    .set({ removedAt: new Date(), removedBy: support.id, fileDeletedAt: new Date() })
    .where(eq(requestAttachment.id, files.removed));
});

/**
 * The text of a downloaded file.
 *
 * @param actor - The reader.
 * @param id - The attachment's ID.
 * @returns Its text, or `null` when there's none for the reader.
 */
async function downloaded(actor: Actor, id: string): Promise<string | null> {
  const stored = await (await loadAttachment(ctx, actor, id))?.readFile();
  return stored ? new Response(stored.body).text() : null;
}

describe('getRequest', () => {
  it('gives each text its own files, a removed one as who removed it', async () => {
    const detail = await getRequest(ctx, client, number);

    expect(detail.description.attachments).toEqual([
      { id: files.description, name: 'screenshot.png', size: 15, preview: true, removed: null },
    ]);
    const reply = detail.entries.find((entry) => entry.id === replyId);
    expect(reply?.body?.attachments).toEqual([
      { id: files.reply, name: 'printer.log', size: 15, preview: false, removed: null },
      {
        id: files.removed,
        name: 'password.png',
        size: 15,
        // Its preview went with it.
        preview: false,
        removed: { by: expect.objectContaining({ side: 'staff' }), at: expect.any(Date) },
      },
    ]);
    // No unsent file shows anywhere.
    expect(JSON.stringify(detail)).not.toContain(files.unsent);
  });

  it('gives a note’s files to the staff only', async () => {
    const forClient = await getRequest(ctx, client, number);
    expect(JSON.stringify(forClient)).not.toContain(files.note);
    expect(JSON.stringify(forClient)).not.toContain('driver notes');

    const forFinance = await getRequest(ctx, finance, number);
    const note = forFinance.entries.find((entry) => entry.id === noteId);
    expect(note?.body?.attachments?.map((file) => file.name)).toEqual(['driver notes.txt']);
  });
});

describe('getRequest: every file on the request', () => {
  it('lists the files a company reader may open, each with the text it was sent with', async () => {
    const detail = await getRequest(ctx, client, number);

    // No note’s file, no removed file and no unsent one.
    expect(detail.files).toEqual([
      { id: files.description, name: 'screenshot.png', size: 15, preview: true, entry: null },
      {
        id: files.reply,
        name: 'printer.log',
        size: 15,
        preview: false,
        entry: {
          id: replyId,
          kind: 'comment',
          author: expect.objectContaining({ side: 'company', isViewer: true, userId: null }),
          at: expect.any(Date),
        },
      },
    ]);
  });

  it('lists a note’s files for the staff, in the order they read the conversation', async () => {
    const oldestFirst = await getRequest(ctx, finance, number);
    expect(oldestFirst.files.map(({ name }) => name)).toEqual([
      'screenshot.png',
      'printer.log',
      'driver notes.txt',
    ]);
    // The note's author has no account here: their side's name shows instead.
    expect(oldestFirst.files.at(-1)?.entry).toEqual({
      id: noteId,
      kind: 'note',
      author: { userId: null, name: null, side: 'staff', isViewer: false, picture: null },
      at: expect.any(Date),
    });

    // With the newest first, the description's files still come first, as on the page.
    await setActivityView(ctx, finance, { order: 'newest' });
    const newestFirst = await getRequest(ctx, finance, number);
    expect(newestFirst.files.map(({ name }) => name)).toEqual([
      'screenshot.png',
      'driver notes.txt',
      'printer.log',
    ]);
  });

  it('lists an internal request’s files for the staff', async () => {
    const internal = await storeRequest(null, { createdBy: support.id, createdBySide: 'staff' });
    const id = await storeAttachment(db, storage, {
      requestId: internal.id,
      uploadedBy: support.id,
      name: 'rota.pdf',
    });

    const detail = await getRequest(ctx, finance, String(internal.number));

    expect(detail.files).toEqual([{ id, name: 'rota.pdf', size: 15, preview: false, entry: null }]);
  });
});

describe('loadAttachment', () => {
  it('gives a file to whoever may read its text, as a download', async () => {
    const file = await loadAttachment(ctx, client, files.reply);
    expect(file).toMatchObject({ name: 'printer.log', contentType: 'text/plain' });
    expect(await downloaded(client, files.reply)).toBe('printer offline');
    expect(await downloaded(support, files.description)).toBe('printer offline');
  });

  it('gives a note’s file to the readers of notes only', async () => {
    expect(await downloaded(client, files.note)).toBeNull();
    expect(await downloaded(finance, files.note)).toBe('printer offline');
  });

  it('gives nobody an unsent or removed file, or one of another company', async () => {
    expect(await downloaded(client, files.unsent)).toBeNull();
    expect(await downloaded(support, files.removed)).toBeNull();
    const other = await memberActor(
      db,
      (await createCompany(db, { name: 'Adiutor Tests B' })).id,
      'admin',
    );
    expect(await downloaded(other, files.reply)).toBeNull();
    expect(await downloaded(client, 'not-an-id')).toBeNull();
  });

  it('checks the reader before the storage, and reads it only for the bytes', async () => {
    const get = vi.spyOn(storage, 'get');
    expect(await loadAttachment(ctx, client, files.note)).toBeNull();
    expect(await loadAttachment(ctx, support, files.removed)).toBeNull();
    const file = await loadAttachment(ctx, client, files.reply);
    expect(file).toMatchObject({ name: 'printer.log' });
    // Nothing is read for someone refused, nor before the file's bytes are wanted.
    expect(get).not.toHaveBeenCalled();
    const stored = await file?.readFile();
    expect(stored?.size).toBe(15);
    expect(get).toHaveBeenCalledExactlyOnceWith(attachmentKey(files.reply));
    get.mockRestore();
  });

  it('gives a file’s preview to whoever may read the file, and only when it has one', async () => {
    /**
     * The text of a file's preview, for a reader.
     *
     * @param actor - The reader.
     * @param id - The attachment's ID.
     * @returns Its text, or `null` when there's none for the reader.
     */
    const previewOf = async (actor: Actor, id: string): Promise<string | null> => {
      const file = await loadAttachment(ctx, actor, id);
      const stored = file?.hasPreview ? await file.readPreview() : null;
      return stored ? new Response(stored.body).text() : null;
    };
    const get = vi.spyOn(storage, 'get');

    expect(await previewOf(client, files.description)).toBe('preview');
    expect(get).toHaveBeenCalledExactlyOnceWith(previewKey(files.description));
    // A note's preview, like its file, is for the readers of notes only.
    expect(await previewOf(client, files.note)).toBeNull();
    expect(await previewOf(finance, files.note)).toBe('preview');
    // A removed file's is gone with it; a log has none.
    expect(await previewOf(support, files.removed)).toBeNull();
    expect((await loadAttachment(ctx, client, files.reply))?.hasPreview).toBe(false);
    get.mockRestore();
  });

  it('reads a part of a file for whoever may read it, as a video player asks', async () => {
    const part = await (
      await loadAttachment(ctx, client, files.reply)
    )?.readFilePart({
      start: 0,
      end: 6,
    });
    if (!part || 'unsatisfiable' in part) {
      throw new Error('Expected a part.');
    }
    expect(part).toMatchObject({ start: 0, end: 6, total: 15 });
    expect(await new Response(part.body).text()).toBe('printer');
    // Nothing for a reader who may not read it.
    expect(await loadAttachment(ctx, client, files.note)).toBeNull();
  });

  it('keeps a deactivated company’s files for the staff only', async () => {
    await db.update(company).set({ deactivatedAt: new Date() }).where(eq(company.id, companyId));
    expect(await downloaded(client, files.reply)).toBeNull();
    expect(await downloaded(support, files.reply)).toBe('printer offline');
  });

  it('gives nothing when the file is missing from the storage, and says so in the log', async () => {
    await storage.delete(attachmentKey(files.reply));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await downloaded(client, files.reply)).toBeNull();
    expect(warn).toHaveBeenCalledWith('An attachment has no file in the storage:', files.reply);
    warn.mockRestore();
  });
});
