/**
 * @file Integration tests for removing an attachment: only the staff who work
 * on requests may, on any of the request's texts and whatever its status; the
 * row stays as the mark of who removed it, the file is deleted (or left for
 * the cleanup job when the storage fails), and nothing can download it again.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { company, impersonation, requestAttachment } from '@/db/schema';

import {
  createCompany,
  createStaffSettings,
  fillRateLimitBucket,
  memberActor,
  staffActor,
  storeAttachment,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { RATE_LIMITS } from '../rate-limit';
import { attachmentKey, type FileStorage, StorageError } from '../storage';
import { loadAttachment, removeAttachment } from './attachments';
import { getRequest } from './detail';
import { ctx, db, storage, storeEntry, storeRequest } from './test-helpers';

/** The request's company, its client, and a staff member who works on requests. */
let companyId: string;
let client: Actor;
let support: Actor;

/** The request's number, and a file on its description and on a note. */
let number: string;
let requestId: string;
let onDescription: string;
let onNote: string;

beforeEach(async () => {
  await createStaffSettings(db);
  companyId = (await createCompany(db)).id;
  client = await memberActor(db, companyId, 'client');
  support = await staffActor(db, 'support');
  const stored = await storeRequest(companyId, { createdBy: client.id, status: 'done' });
  requestId = stored.id;
  number = String(stored.number);
  const noteId = (await storeEntry(requestId, { kind: 'note', authorSide: 'staff', body: 'Hm.' }))
    .id;
  onDescription = await storeAttachment(db, storage, {
    requestId,
    uploadedBy: client.id,
    name: 'password.png',
    contentType: 'image/png',
  });
  onNote = await storeAttachment(db, storage, {
    requestId,
    entryId: noteId,
    uploadedBy: support.id,
  });
});

/**
 * A file's row as it's stored.
 *
 * @param id - The file.
 * @returns Its row.
 */
async function rowOf(id: string) {
  const [row] = await db.select().from(requestAttachment).where(eq(requestAttachment.id, id));
  return row;
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

describe('removeAttachment', () => {
  it('removes a file on a done request, keeps who removed it, and deletes its file', async () => {
    expect(
      await removeAttachment(ctx, support, { request: number, attachment: onDescription }),
    ).toEqual({ name: 'password.png' });

    const row = await rowOf(onDescription);
    expect(row).toMatchObject({ removedBy: support.id, removedSignedInAs: false });
    expect(row?.removedAt).toBeInstanceOf(Date);
    expect(row?.fileDeletedAt).toBeInstanceOf(Date);
    expect(await storage.get(attachmentKey(onDescription))).toBeNull();
    expect(await loadAttachment(ctx, client, onDescription)).toBeNull();

    // Its place says who removed it, to the company too.
    const detail = await getRequest(ctx, client, number);
    expect(detail.description.attachments).toEqual([
      expect.objectContaining({
        id: onDescription,
        name: 'password.png',
        removed: expect.objectContaining({ by: expect.objectContaining({ name: support.name }) }),
      }),
    ]);
  });

  it('removes a file on an internal note too', async () => {
    await removeAttachment(ctx, support, { request: number, attachment: onNote });
    expect((await rowOf(onNote))?.removedAt).toBeInstanceOf(Date);
  });

  it('is for the staff who work on requests only', async () => {
    const admin = await memberActor(db, companyId, 'admin');
    const finance = await staffActor(db, 'finance');
    const refusals = await Promise.all(
      [client, admin, finance].map((actor) =>
        refusal(() => removeAttachment(ctx, actor, { request: number, attachment: onDescription })),
      ),
    );
    expect(refusals.map((error) => error.code)).toEqual(['forbidden', 'forbidden', 'forbidden']);
    expect((await rowOf(onDescription))?.removedAt).toBeNull();
  });

  it('reports a file that’s removed already, another request’s, or not an ID as not found', async () => {
    const other = await storeRequest(companyId);
    const elsewhere = await storeAttachment(db, storage, { requestId: other.id });
    await removeAttachment(ctx, support, { request: number, attachment: onDescription });

    const codes = await Promise.all(
      [onDescription, elsewhere, 'not-an-id'].map(async (attachment) => {
        const error = await refusal(() =>
          removeAttachment(ctx, support, { request: number, attachment }),
        );
        return error.code;
      }),
    );
    expect(codes).toEqual(['not_found', 'not_found', 'not_found']);
  });

  it('refuses on a deactivated company, and past the limit of request changes', async () => {
    const deactivated = await refusal(async () => {
      await db.update(company).set({ deactivatedAt: new Date() }).where(eq(company.id, companyId));
      return removeAttachment(ctx, support, { request: number, attachment: onDescription });
    });
    expect(deactivated.code).toBe('invalid');
    await db.update(company).set({ deactivatedAt: null }).where(eq(company.id, companyId));

    await fillRateLimitBucket(
      db,
      `request-change:user:${support.id}`,
      RATE_LIMITS.requestChangesPerUser.limit,
    );
    const limited = await refusal(() =>
      removeAttachment(ctx, support, { request: number, attachment: onDescription }),
    );
    expect(limited.code).toBe('rate_limited');
  });

  it('records a staff member who removed it while signed in as someone', async () => {
    const admin = await staffActor(db, 'platform_admin');
    const endsAt = new Date(Date.now() + 30 * 60_000);
    await db.insert(impersonation).values({
      staffUserId: admin.id,
      userId: support.id,
      returnTo: '/dashboard',
      expiresAt: endsAt,
    });
    const asSupport: Actor = {
      ...support,
      signedInAs: {
        staffId: admin.id,
        staffName: admin.name,
        endsAt,
        returnTo: '/dashboard',
        staffPermissions: ['users:view', 'users:manage', 'audit:view'],
      },
    };

    await removeAttachment(ctx, asSupport, { request: number, attachment: onDescription });

    expect(await rowOf(onDescription)).toMatchObject({
      removedBy: support.id,
      removedSignedInAs: true,
      removedSignedInAsStaffId: admin.id,
    });
  });

  it('leaves the file for the cleanup job when the storage fails, and still removes it', async () => {
    const failing: FileStorage = {
      ...storage,
      /**
       * Fails as an unreachable storage does.
       *
       * @returns Never.
       */
      delete: async () => {
        throw new StorageError('unreachable');
      },
    };
    const withFailing: ServiceContext = {
      ...ctx,
      /**
       * The failing storage.
       *
       * @returns It.
       */
      storage: async () => failing,
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await removeAttachment(withFailing, support, { request: number, attachment: onDescription });

    const row = await rowOf(onDescription);
    expect(row?.removedAt).toBeInstanceOf(Date);
    expect(row?.fileDeletedAt).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "A removed attachment's file could not be deleted yet:",
      'unreachable',
    );
    error.mockRestore();
  });
});
