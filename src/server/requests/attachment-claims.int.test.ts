/**
 * @file Integration tests for sending uploads with a text: a new request's
 * description, a reply and an internal note each take the files their
 * writer uploaded, and a file that isn't theirs to send (someone else's,
 * expired, unfinished, sent already, or uploaded while a staff member was
 * signed in as them) refuses the whole text, which then stores nothing.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { impersonation, requestAttachment, requestEntry } from '@/db/schema';
import { MAX_ATTACHMENTS_PER_TEXT } from '@/lib/requests';

import {
  createCompany,
  createStaffSettings,
  memberActor,
  minutesAgo,
  staffActor,
  storeAttachment,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { ServiceError } from '../errors';
import addNote from './notes';
import raiseRequest from './raise';
import replyToRequest from './reply';
import { ctx, db, entriesOf, storage, storeRequest } from './test-helpers';

/** The company the requests are in. */
let companyId: string;
/** Someone at the company who writes requests. */
let client: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  companyId = (await createCompany(db)).id;
  client = await memberActor(db, companyId, 'client');
});

/**
 * Where files are now: each one's request and entry, by ID.
 *
 * @param ids - The files.
 * @returns Each file's place, in the order given.
 */
async function placesOf(ids: readonly string[]) {
  const rows = await db
    .select({
      id: requestAttachment.id,
      requestId: requestAttachment.requestId,
      entryId: requestAttachment.entryId,
    })
    .from(requestAttachment);
  return ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    return { requestId: row?.requestId ?? null, entryId: row?.entryId ?? null };
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
 * Signs a staff member in as a user: the row the sign-in keeps, and the
 * user as the actor, with the staff member on it.
 *
 * @param staff - The staff member.
 * @param target - The user they sign in as.
 * @returns The user, as the actor while the staff member is signed in as them.
 */
async function signInAs(staff: Actor, target: Actor): Promise<Actor> {
  const endsAt = new Date(Date.now() + 30 * 60_000);
  await db.insert(impersonation).values({
    staffUserId: staff.id,
    userId: target.id,
    returnTo: '/dashboard',
    expiresAt: endsAt,
  });
  return {
    ...target,
    signedInAs: {
      staffId: staff.id,
      staffName: staff.name,
      endsAt,
      returnTo: '/dashboard',
      staffPermissions: ['users:view', 'users:manage', 'audit:view'],
    },
  };
}

describe('sending files with a text', () => {
  it('puts a new request’s files on its description', async () => {
    const files = [
      await storeAttachment(db, storage, { uploadedBy: client.id, name: 'error.png' }),
      await storeAttachment(db, storage, { uploadedBy: client.id }),
    ];

    const raised = await raiseRequest(ctx, client, {
      companyId,
      title: 'The printer is broken',
      description: 'The screenshot and the log are attached.',
      type: 'bug',
      attachments: [...files, files[0] ?? ''],
    });

    expect(await placesOf(files)).toEqual([
      { requestId: raised.id, entryId: null },
      { requestId: raised.id, entryId: null },
    ]);
  });

  it('puts a reply’s files on the reply, and a note’s on the note', async () => {
    const raised = await storeRequest(companyId);
    const support = await staffActor(db, 'support');
    const log = await storeAttachment(db, storage, { uploadedBy: client.id });
    const notes = await storeAttachment(db, storage, { uploadedBy: support.id });

    await replyToRequest(ctx, client, {
      request: String(raised.number),
      body: 'The log is attached.',
      attachments: [log],
    });
    await addNote(ctx, support, {
      request: String(raised.number),
      body: 'Driver notes attached.',
      attachments: [notes],
    });

    const [reply, note] = await entriesOf(raised.id);
    expect(await placesOf([log, notes])).toEqual([
      { requestId: raised.id, entryId: reply?.id },
      { requestId: raised.id, entryId: note?.id },
    ]);
    expect(note?.kind).toBe('note');
  });

  it('refuses a file someone else uploaded, without naming it, and stores no reply', async () => {
    const raised = await storeRequest(companyId);
    const colleague = await memberActor(db, companyId, 'client');
    const own = await storeAttachment(db, storage, { uploadedBy: client.id });
    const theirs = await storeAttachment(db, storage, {
      uploadedBy: colleague.id,
      name: 'salaries.xlsx',
    });

    const error = await refusal(() =>
      replyToRequest(ctx, client, {
        request: String(raised.number),
        body: 'Attached.',
        attachments: [own, theirs],
      }),
    );

    expect(error).toMatchObject({
      code: 'conflict',
      key: 'errors.attachments.someUnavailable',
    });
    expect(await entriesOf(raised.id)).toEqual([]);
    expect(await placesOf([own, theirs])).toEqual([
      { requestId: null, entryId: null },
      { requestId: null, entryId: null },
    ]);
  });

  it('names an own file that can’t be sent any more: expired, unfinished or sent already', async () => {
    const raised = await storeRequest(companyId);
    const sentAlready = await storeRequest(companyId);
    const unsendable = [
      await storeAttachment(db, storage, {
        uploadedBy: client.id,
        name: 'yesterday.log',
        createdAt: minutesAgo(25 * 60),
      }),
      await storeAttachment(db, storage, {
        uploadedBy: client.id,
        name: 'half.log',
        uploadedAt: null,
      }),
      await storeAttachment(db, storage, {
        uploadedBy: client.id,
        name: 'sent.log',
        requestId: sentAlready.id,
      }),
    ];

    const names = await Promise.all(
      unsendable.map(async (file) => {
        const error = await refusal(() =>
          replyToRequest(ctx, client, {
            request: String(raised.number),
            body: 'Attached.',
            attachments: [file],
          }),
        );
        expect(error).toMatchObject({ code: 'conflict', key: 'errors.attachments.unavailable' });
        return error.values?.name;
      }),
    );

    expect(names).toEqual(['yesterday.log', 'half.log', 'sent.log']);
    expect(await entriesOf(raised.id)).toEqual([]);
  });

  it('refuses an ID that isn’t one', async () => {
    const raised = await storeRequest(companyId);
    const error = await refusal(() =>
      replyToRequest(ctx, client, {
        request: String(raised.number),
        body: 'Attached.',
        attachments: ['../../etc/passwd'],
      }),
    );
    expect(error.key).toBe('errors.attachments.someUnavailable');
  });

  it(`refuses more than ${MAX_ATTACHMENTS_PER_TEXT} files on one text`, async () => {
    const raised = await storeRequest(companyId);
    const files = await Promise.all(
      Array.from({ length: MAX_ATTACHMENTS_PER_TEXT + 1 }, () =>
        storeAttachment(db, storage, { uploadedBy: client.id }),
      ),
    );

    const error = await refusal(() =>
      replyToRequest(ctx, client, {
        request: String(raised.number),
        body: 'Attached.',
        attachments: files,
      }),
    );

    expect(error).toMatchObject({
      code: 'invalid',
      key: 'errors.attachments.tooMany',
      values: { maximum: MAX_ATTACHMENTS_PER_TEXT },
    });
    expect(
      await db
        .select({ id: requestAttachment.id })
        .from(requestAttachment)
        .where(
          and(eq(requestAttachment.uploadedBy, client.id), isNull(requestAttachment.requestId)),
        ),
    ).toHaveLength(MAX_ATTACHMENTS_PER_TEXT + 1);
  });

  it('sends a file uploaded while signed in as someone only while signed in as them again', async () => {
    const raised = await storeRequest(companyId);
    const admin = await staffActor(db, 'platform_admin');
    const asClient = await signInAs(admin, client);
    const file = await storeAttachment(db, storage, {
      uploadedBy: client.id,
      signedInAsStaffId: admin.id,
    });

    // The user alone didn't upload it.
    const error = await refusal(() =>
      replyToRequest(ctx, client, {
        request: String(raised.number),
        body: 'Attached.',
        attachments: [file],
      }),
    );
    expect(error.key).toBe('errors.attachments.unavailable');

    await replyToRequest(ctx, asClient, {
      request: String(raised.number),
      body: 'Attached for you.',
      attachments: [file],
    });
    const [reply] = await db
      .select({ id: requestEntry.id })
      .from(requestEntry)
      .where(eq(requestEntry.requestId, raised.id));
    expect(await placesOf([file])).toEqual([{ requestId: raised.id, entryId: reply?.id }]);
  });
});
