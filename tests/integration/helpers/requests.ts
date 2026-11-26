/**
 * @file Storing requests and the people on them directly, for tests that
 * are about something else, and reading back who a request is assigned to.
 */
import { and, eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { request, requestAttachment, requestEntry, requestParticipant } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { incrementSetting } from '@/server/settings';
import { attachmentKey, type FileStorage } from '@/server/storage';

/** What a stored request may be given; everything else gets a default. */
export type RequestValues = Partial<typeof request.$inferInsert>;

/**
 * Stores a request without going through the service, with the next number
 * (`requests.last_number`, so requests raised afterwards continue from it).
 *
 * @param db - Test database.
 * @param companyId - The company it's in, or `null` for an internal request (raised by the staff).
 * @param values - What to store instead of the defaults (a normal bug, open, raised by nobody at
 *   the company, or by nobody on the staff for an internal request).
 * @returns The stored request.
 */
export async function storeRequest(
  db: Database,
  companyId: string | null,
  values: RequestValues = {},
) {
  return db.transaction(async (tx) => {
    const { value: number } = await incrementSetting(tx, 'requests.last_number');
    return firstRow(
      await tx
        .insert(request)
        .values({
          number,
          companyId,
          title: 'The printer is broken',
          description: 'It prints blank pages.',
          type: 'bug',
          priority: 'normal',
          createdBySide: companyId === null ? 'staff' : 'company',
          ...values,
        })
        .returning(),
      'the stored request',
    );
  });
}

/**
 * Puts people on a request without going through a service.
 *
 * @param db - Test database.
 * @param requestId - The request.
 * @param userIds - The people.
 * @param role - Whether they're assigned to it or subscribed to it.
 */
export async function storeParticipants(
  db: Database,
  requestId: string,
  userIds: readonly string[],
  role: 'assignee' | 'subscriber',
): Promise<void> {
  if (userIds.length > 0) {
    await db
      .insert(requestParticipant)
      .values(userIds.map((userId) => ({ requestId, userId, role })));
  }
}

/**
 * The staff members a request is assigned to, as stored.
 *
 * @param db - Test database.
 * @param requestId - The request.
 * @returns Their user IDs, sorted.
 */
export async function assigneesOf(db: Database, requestId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: requestParticipant.userId })
    .from(requestParticipant)
    .where(
      and(eq(requestParticipant.requestId, requestId), eq(requestParticipant.role, 'assignee')),
    );
  return rows.map(({ userId }) => userId).sort();
}

/**
 * The assignment entries in a request's history, in order.
 *
 * @param db - Test database.
 * @param requestId - The request.
 * @returns Each entry as `[change, subject, author]`: assigned or unassigned, the staff member
 *   it's about (`null` once their account is gone), and who did it (`null` for nobody).
 */
export async function assignmentsOf(db: Database, requestId: string) {
  const entries = await db
    .select()
    .from(requestEntry)
    .where(and(eq(requestEntry.requestId, requestId), eq(requestEntry.kind, 'assignee')))
    .orderBy(requestEntry.id);
  return entries.map(({ toValue, subjectUserId, authorId }) => [toValue, subjectUserId, authorId]);
}

/**
 * Stores an attached file directly, row and file, as an upload (and a text
 * that claimed it) would have: unsent unless a request is given, stored
 * unless `uploadedAt` is `null`.
 *
 * @param db - Database client.
 * @param storage - Where its file goes.
 * @param values - What differs from a small text file uploaded just now.
 * @param values.requestId - The request it was sent with; unsent without one.
 * @param values.entryId - The reply or note it belongs to; the description without one.
 * @param values.uploadedBy - Who uploaded it.
 * @param values.name - Its name.
 * @param values.contentType - Its type.
 * @param values.bytes - The file.
 * @param values.createdAt - When the upload started.
 * @param values.uploadedAt - When it was stored; `null` for an upload that never finished.
 * @param values.signedInAsStaffId - The staff member signed in as the uploader, if any.
 * @returns Its ID.
 */
export async function storeAttachment(
  db: Database,
  storage: FileStorage,
  values: {
    requestId?: string | null;
    entryId?: string | null;
    uploadedBy?: string | null;
    name?: string;
    contentType?: string;
    bytes?: Uint8Array<ArrayBuffer>;
    createdAt?: Date;
    uploadedAt?: Date | null;
    signedInAsStaffId?: string;
  } = {},
): Promise<string> {
  const bytes = values.bytes ?? new TextEncoder().encode('printer offline');
  const createdAt = values.createdAt ?? new Date();
  const uploadedAt = values.uploadedAt === undefined ? createdAt : values.uploadedAt;
  const stored = firstRow(
    await db
      .insert(requestAttachment)
      .values({
        requestId: values.requestId ?? null,
        entryId: values.entryId ?? null,
        uploadedBy: values.uploadedBy ?? null,
        signedInAs: values.signedInAsStaffId !== undefined,
        signedInAsStaffId: values.signedInAsStaffId ?? null,
        name: values.name ?? 'printer.log',
        contentType: values.contentType ?? 'text/plain',
        size: bytes.byteLength,
        createdAt,
        uploadedAt,
      })
      .returning({ id: requestAttachment.id }),
    'the attachment',
  );
  if (uploadedAt !== null) {
    await storage.put(attachmentKey(stored.id), bytes, values.contentType ?? 'text/plain');
  }
  return stored.id;
}
