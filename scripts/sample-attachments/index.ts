/**
 * @file Files attached to the sample requests in the development data
 * (decision 0044): screenshots (`screenshots.tsx`), invoices, a log and a
 * status report (`documents.ts`) on descriptions, replies and an internal
 * note, one file on some texts and several on others. Used by the
 * development seed (`scripts/seed-dev.ts`) and by `pnpm db:seed:attachments`,
 * which adds them to the data as it is (`scripts/seed-attachments.ts`). This
 * folder's public API.
 *
 * The texts are found by their company and request title, a reply by its
 * writer and how it starts, so replies typed by hand are never touched. Each
 * file is stored the way an upload and the text that claims it would: its
 * row first, unsent, then its bytes in the storage, then the row is marked
 * sent with the text's time. It's safe to run again: a file already there is
 * left alone, one whose bytes are missing from the storage is stored again,
 * and a removed one is never brought back.
 */
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';

import type { Database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { firstRow } from '../../src/lib/defined';
import { attachmentTypeOf, WRITTEN_TEXT_FORMAT } from '../../src/lib/requests';
import { type StorageEnvironment, storageFromEnvironment } from '../../src/lib/storage';
import { attachmentKey, type FileStorage } from '../../src/server/storage';
import {
  invoiceWithNewAddress,
  invoiceWithOldAddress,
  paymentProviderLog,
  printerStatus,
} from './documents';
import { MINUTE, type SampleFile, type SampleFileMaker } from './files';
import {
  blankTestPage,
  checkoutError,
  failedCheckouts,
  invoiceEmail,
  openingHoursPreview,
  signUpForm,
} from './screenshots';

/** The text of a sample request that files are attached to. */
type SampleText =
  | {
      /** The request's description. */
      kind: 'description';
    }
  | {
      /** A reply. */
      kind: 'reply';
      /** Its writer's email address. */
      by: string;
      /** How it starts. */
      startsWith: string;
    }
  | {
      /** An internal note, added when it isn't there yet. */
      kind: 'note';
      /** Its writer's email address, someone on the staff. */
      by: string;
      /** Its text. */
      body: string;
    };

/** Files attached to one text of a sample request. */
interface SampleAttachments {
  /** The request's company. */
  company: string;
  /** The request's title. */
  title: string;
  /** The text. */
  text: SampleText;
  /** Its files, in the order they're attached. */
  files: readonly SampleFileMaker[];
}

/** How long after a request's latest entry the sample note is written. */
const NOTE_AFTER = 30 * MINUTE;

/** How many characters of a note find it again, so a note edited later still counts. */
const NOTE_KEY_LENGTH = 48;

/** Which texts get which files. */
const SAMPLE_ATTACHMENTS: readonly SampleAttachments[] = [
  {
    company: 'Adiutor Tests Alpha',
    title: 'Checkout shows an error after paying',
    text: { kind: 'description' },
    files: [checkoutError],
  },
  {
    company: 'Adiutor Tests Alpha',
    title: 'Checkout shows an error after paying',
    text: {
      kind: 'note',
      by: 'support@adiutor.test',
      body: 'Logs from the payment provider: every payment goes through, but since this morning their status call times out after 10 seconds, so our confirmation page gives up. The chart shows the failed confirmations per hour. I’ve asked the provider whether they changed anything.',
    },
    files: [paymentProviderLog, failedCheckouts],
  },
  {
    company: 'Adiutor Tests Alpha',
    title: 'Wrong address on invoices',
    text: { kind: 'description' },
    files: [invoiceWithOldAddress],
  },
  {
    company: 'Adiutor Tests Alpha',
    title: 'Wrong address on invoices',
    text: {
      kind: 'reply',
      by: 'alpha.admin@adiutor.test',
      startsWith: 'The PDF is right now',
    },
    files: [invoiceEmail, invoiceWithNewAddress],
  },
  {
    company: 'Adiutor Tests Alpha',
    title: 'The printer on floor 2 prints blank pages',
    text: { kind: 'description' },
    files: [blankTestPage, printerStatus],
  },
  {
    company: 'Adiutor Tests Alpha',
    title: 'Update the opening hours on the website',
    text: { kind: 'reply', by: 'support@adiutor.test', startsWith: 'Done on the test site' },
    files: [openingHoursPreview],
  },
  {
    company: 'Adiutor Tests Beta',
    title: 'The newsletter sign-up form is broken',
    text: { kind: 'description' },
    files: [signUpForm],
  },
];

/** A text that was found, as its files need it. */
interface FoundText {
  /** The request. */
  requestId: string;
  /** The reply or note, or `null` for the description. */
  entryId: string | null;
  /** Who wrote it: the files' uploader. */
  authorId: string;
  /** When it was written: when its files count as uploaded. */
  at: Date;
}

/** What attaching the sample files did. */
export interface SampleAttachmentsSummary {
  /** Files stored for the first time. */
  added: number;
  /** Files that were there already. */
  alreadyThere: number;
  /** Files whose row was there, but whose bytes weren't in the storage, stored again. */
  restored: number;
  /** The texts that weren't found (or have no writer any more), described. */
  notFound: string[];
}

/**
 * A user's ID, by their email address.
 *
 * @param db - Database client.
 * @param email - Their address.
 * @returns Their ID, or `null` when there's no such account.
 */
async function userIdOf(db: Database, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  return row?.id ?? null;
}

/**
 * Adds a sample note to a request, after everything else that happened to
 * it, as `addNote` would: on the staff's side, in Markdown, with its writer
 * subscribed. Notes are only for the staff, so the request's last activity
 * stays as it was.
 *
 * @param db - Database client.
 * @param requestId - The request.
 * @param authorId - Who writes it.
 * @param body - Its text.
 * @returns The note, as a found text.
 */
async function addSampleNote(
  db: Database,
  requestId: string,
  authorId: string,
  body: string,
): Promise<FoundText> {
  const [latest] = await db
    .select({ at: max(schema.requestEntry.createdAt) })
    .from(schema.requestEntry)
    .where(eq(schema.requestEntry.requestId, requestId));
  const [request] = await db
    .select({ at: schema.request.createdAt })
    .from(schema.request)
    .where(eq(schema.request.id, requestId));
  const after = latest?.at ?? request?.at ?? new Date();
  const at = new Date(Math.min(after.getTime() + NOTE_AFTER, Date.now()));
  const note = firstRow(
    await db
      .insert(schema.requestEntry)
      .values({
        requestId,
        kind: 'note',
        authorId,
        authorSide: 'staff',
        body,
        bodyFormat: WRITTEN_TEXT_FORMAT,
        createdAt: at,
      })
      .returning({ id: schema.requestEntry.id }),
    'the sample note',
  );
  await db
    .insert(schema.requestParticipant)
    .values({ requestId, userId: authorId, role: 'subscriber' })
    .onConflictDoNothing();
  return { requestId, entryId: note.id, authorId, at };
}

/**
 * Finds the text a sample's files go to, adding the sample note when it
 * isn't there yet.
 *
 * @param db - Database client.
 * @param sample - The sample.
 * @returns The text, or `null` when it isn't there (or its writer is gone).
 */
async function findText(db: Database, sample: SampleAttachments): Promise<FoundText | null> {
  const [request] = await db
    .select({
      id: schema.request.id,
      createdBy: schema.request.createdBy,
      createdAt: schema.request.createdAt,
    })
    .from(schema.request)
    .innerJoin(schema.company, eq(schema.company.id, schema.request.companyId))
    .where(and(eq(schema.company.name, sample.company), eq(schema.request.title, sample.title)))
    .orderBy(schema.request.number)
    .limit(1);
  if (!request) {
    return null;
  }
  const { text } = sample;
  if (text.kind === 'description') {
    return request.createdBy
      ? { requestId: request.id, entryId: null, authorId: request.createdBy, at: request.createdAt }
      : null;
  }
  const authorId = await userIdOf(db, text.by);
  if (!authorId) {
    return null;
  }
  const opening = text.kind === 'reply' ? text.startsWith : text.body.slice(0, NOTE_KEY_LENGTH);
  const [entry] = await db
    .select({ id: schema.requestEntry.id, at: schema.requestEntry.createdAt })
    .from(schema.requestEntry)
    .where(
      and(
        eq(schema.requestEntry.requestId, request.id),
        eq(schema.requestEntry.kind, text.kind === 'reply' ? 'comment' : 'note'),
        eq(schema.requestEntry.authorId, authorId),
        sql`starts_with(${schema.requestEntry.body}, ${opening})`,
      ),
    )
    .orderBy(schema.requestEntry.id)
    .limit(1);
  if (entry) {
    return { requestId: request.id, entryId: entry.id, authorId, at: entry.at };
  }
  return text.kind === 'note' ? addSampleNote(db, request.id, authorId, text.body) : null;
}

/**
 * Attaches one file to a text, unless it's there already.
 *
 * @param db - Database client.
 * @param storage - The storage, in the session the files are stored in.
 * @param text - The text.
 * @param file - The file.
 * @returns What happened to it.
 * @throws {Error} When the file's type isn't on the allow-list (a mistake in the samples).
 */
async function attachFile(
  db: Database,
  storage: FileStorage,
  text: FoundText,
  file: SampleFile,
): Promise<'added' | 'alreadyThere' | 'restored'> {
  const type = attachmentTypeOf(file.name);
  if (!type) {
    throw new Error(`The sample file ${file.name} has a type that can't be attached.`);
  }
  const [existing] = await db
    .select({ id: schema.requestAttachment.id, removedAt: schema.requestAttachment.removedAt })
    .from(schema.requestAttachment)
    .where(
      and(
        eq(schema.requestAttachment.requestId, text.requestId),
        text.entryId === null
          ? isNull(schema.requestAttachment.entryId)
          : eq(schema.requestAttachment.entryId, text.entryId),
        eq(schema.requestAttachment.name, file.name),
      ),
    )
    .orderBy(desc(schema.requestAttachment.id))
    .limit(1);
  if (existing) {
    // A removed file stays removed.
    if (existing.removedAt) {
      return 'alreadyThere';
    }
    const stored = await storage.get(attachmentKey(existing.id));
    if (stored) {
      await stored.body.cancel();
      return 'alreadyThere';
    }
    await storage.put(attachmentKey(existing.id), file.bytes, type.contentType);
    await db
      .update(schema.requestAttachment)
      .set({ size: file.bytes.byteLength })
      .where(eq(schema.requestAttachment.id, existing.id));
    return 'restored';
  }

  // Unsent and started now, as an upload is, so the cleanup job leaves it alone while it's stored.
  const row = firstRow(
    await db
      .insert(schema.requestAttachment)
      .values({
        uploadedBy: text.authorId,
        name: file.name,
        contentType: type.contentType,
        size: file.bytes.byteLength,
      })
      .returning({ id: schema.requestAttachment.id }),
    'the sample attachment',
  );
  // A storage that fails may still have kept the file (a timeout after it stored it): the row
  // stays unsent and unfinished, and the cleanup job deletes both after an hour, as for an upload.
  await storage.put(attachmentKey(row.id), file.bytes, type.contentType);
  // Sent with its text, and uploaded when the text was written.
  await db
    .update(schema.requestAttachment)
    .set({
      requestId: text.requestId,
      entryId: text.entryId,
      createdAt: text.at,
      uploadedAt: text.at,
    })
    .where(eq(schema.requestAttachment.id, row.id));
  return 'added';
}

/**
 * Describes a sample's text, for the summary.
 *
 * @param sample - The sample.
 * @returns E.g. `"Wrong address on invoices" (Adiutor Tests Alpha), a reply`.
 */
function textLabel(sample: SampleAttachments): string {
  const what = { description: 'its description', reply: 'a reply', note: 'a note' }[
    sample.text.kind
  ];
  return `"${sample.title}" (${sample.company}), ${what}`;
}

/**
 * Attaches the sample files to their texts, storing their bytes in the
 * storage given (one connection for all of them).
 *
 * @param db - Database client (not a transaction: each file's row must be there before its bytes).
 * @param storage - The storage files go to.
 * @returns What it did.
 * @throws {StorageError} When the storage fails; the files stored before that stay, and the
 *   one that failed is left to the cleanup job.
 */
export default async function attachSampleFiles(
  db: Database,
  storage: FileStorage,
): Promise<SampleAttachmentsSummary> {
  const summary: SampleAttachmentsSummary = {
    added: 0,
    alreadyThere: 0,
    restored: 0,
    notFound: [],
  };
  await storage.session(async (session) => {
    // One after another: a text's files keep their order, and the note is added once.
    for (const sample of SAMPLE_ATTACHMENTS) {
      // eslint-disable-next-line no-await-in-loop -- One at a time, in order (see above).
      const text = await findText(db, sample);
      if (!text) {
        summary.notFound.push(textLabel(sample));
      } else {
        for (const make of sample.files) {
          // eslint-disable-next-line no-await-in-loop -- Same.
          const result = await attachFile(db, session, text, await make(text.at));
          summary[result] += 1;
        }
      }
    }
  });
  return summary;
}

/**
 * The summary as lines for the developer.
 *
 * @param summary - What attaching the sample files did.
 * @returns The lines.
 */
export function summaryLines(summary: SampleAttachmentsSummary): string[] {
  return [
    `Sample attachments: ${summary.added} added, ${summary.alreadyThere} already there, ${summary.restored} stored again.`,
    ...summary.notFound.map((text) => `Not found, so nothing attached: ${text}.`),
  ];
}

/**
 * Why attachments have no storage, and what to do about it, for the
 * developer: the server's environment turns them off or names too little,
 * or nothing has chosen one yet.
 *
 * @param environment - The server's environment.
 * @returns The message.
 */
export function noStorageMessage(environment: StorageEnvironment): string {
  const chosen = storageFromEnvironment(environment);
  if (chosen.state === 'off') {
    return 'ATTACHMENTS_STORAGE=off in .env turns attachments off, so there are no sample files.';
  }
  if (chosen.state === 'incomplete') {
    return `ATTACHMENTS_STORAGE in .env also needs ${chosen.missing.join(', ')}, so there are no sample files.`;
  }
  return 'Attachments have no storage, so there are no sample files. Choose one on the Integrations tab of Settings, or set ATTACHMENTS_STORAGE in .env (see "Attachments" in docs/development.md).';
}
