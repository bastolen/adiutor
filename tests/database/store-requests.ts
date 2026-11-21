/**
 * @file Stores example requests with their history, for the seeds: the
 * development seed (`scripts/seed-dev.ts`) and the end-to-end seed
 * (`e2e/support/seed.ts`). They're written straight to the tables, with the
 * times the examples say, and the request counter is left at the last
 * number, so requests raised afterwards continue from it.
 */
import { eq } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import * as schema from '../../src/db/schema';
import { firstRow } from '../../src/lib/defined';
import {
  type AssignmentChange,
  isClosedStatus,
  type RequestPriority,
  type RequestSide,
  type RequestStatus,
  type RequestTextFormat,
  storedMentionMarker,
} from '../../src/lib/requests';

/** A Drizzle client on the app's schema, or the open transaction of one. */
type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/** Who wrote or changed something in an example request. */
export interface SamplePerson {
  /** Their user ID. */
  id: string;
  /** The side they act as: the company's, or the staff's. */
  side: RequestSide;
}

/**
 * One entry of an example request's history: a reply, a change, or a staff
 * member assigned or removed.
 */
export type SampleEntry = {
  /** Who wrote or changed it. */
  by: SamplePerson;
  /** When. */
  at: Date;
} & (
  | {
      /** The reply's text. */
      reply: string;
      /** The format it's written in; Markdown, as every new text is, when left out. */
      format?: RequestTextFormat;
      /**
       * The people the reply mentions: the first is who {@link sampleMention}
       * 0 stands for in its text, and so on.
       */
      mentions?: SamplePerson[];
    }
  | {
      /** What changed. */
      change: 'status' | 'title' | 'type' | 'priority';
      /** What it was. */
      from: string;
      /** What it became. */
      to: string;
    }
  | {
      /** Whether the staff member was assigned or removed. */
      assign: AssignmentChange;
      /** The staff member's user ID. */
      subject: string;
    }
);

/** An example request. */
export interface SampleRequest {
  /** The company it's in. */
  companyId: string;
  /** Its title. */
  title: string;
  /** What's asked. */
  description: string;
  /** The format the description is written in; Markdown, as every new text is, when left out. */
  format?: RequestTextFormat;
  /** Its type. */
  type: string;
  /** Its priority, as it is now. */
  priority: RequestPriority;
  /** Its status, as it is now; open when left out. */
  status?: RequestStatus;
  /** Whether it was closed before and is worked on again. */
  reopened?: boolean;
  /** Who raised it. */
  raisedBy: SamplePerson;
  /** When it was raised. */
  at: Date;
  /** Its history, oldest first. */
  entries?: SampleEntry[];
  /** The user IDs of the staff assigned to it now; nobody when left out. */
  assignees?: string[];
}

/**
 * Stands for someone an example reply mentions, in its text, until the reply
 * is stored and the mention has a row to point at.
 *
 * @param index - Their place among the people the reply mentions, from 0.
 * @returns What to write in the reply's text.
 */
export function sampleMention(index: number): string {
  return `{{mention ${index}}}`;
}

/**
 * The row of one entry of an example request's history.
 *
 * @param written - The request it's in, and who wrote it on which side.
 * @param written.requestId - The request.
 * @param written.authorId - Who wrote or changed it.
 * @param written.authorSide - The side they act as.
 * @param entry - The entry.
 * @returns The values to insert.
 */
function entryValues(
  written: { requestId: string; authorId: string; authorSide: RequestSide },
  entry: SampleEntry,
): typeof schema.requestEntry.$inferInsert {
  if ('reply' in entry) {
    return {
      ...written,
      kind: 'comment',
      body: entry.reply,
      bodyFormat: entry.format,
      createdAt: entry.at,
    };
  }
  if ('assign' in entry) {
    return {
      ...written,
      kind: 'assignee',
      subjectUserId: entry.subject,
      toValue: entry.assign,
      createdAt: entry.at,
    };
  }
  return {
    ...written,
    kind: entry.change,
    fromValue: entry.from,
    toValue: entry.to,
    createdAt: entry.at,
  };
}

/**
 * Stores example requests, numbered in the order given, and sets the request
 * counter to the last number.
 *
 * Each request's last activity is its latest entry the company sees (every
 * one but a change of priority), or the moment it was raised. Its assignees
 * are stored as they are now; its entries say how they came to be. A reopened
 * request counts as reopened at that moment.
 *
 * @param db - Database client, or a transaction.
 * @param requests - The requests, in the order of their numbers.
 * @param firstNumber - The first request's number; 1 unless requests exist already.
 * @returns The numbers the requests got, in order.
 */
export default async function storeRequests(
  db: Executor,
  requests: SampleRequest[],
  firstNumber = 1,
): Promise<number[]> {
  const numbers: number[] = [];
  // One after another: IDs are time-ordered, and a request's entries are read in ID order.
  for (const [index, sample] of requests.entries()) {
    const number = firstNumber + index;
    const entries = sample.entries ?? [];
    const seen = entries.filter((entry) => !('change' in entry && entry.change === 'priority'));
    const lastActivityAt = seen.at(-1)?.at ?? sample.at;
    const status = sample.status ?? 'open';
    // eslint-disable-next-line no-await-in-loop -- One at a time, in order (see above).
    const inserted = await db
      .insert(schema.request)
      .values({
        number,
        companyId: sample.companyId,
        title: sample.title,
        description: sample.description,
        descriptionFormat: sample.format,
        type: sample.type,
        priority: sample.priority,
        status,
        reopenedAt: sample.reopened && !isClosedStatus(status) ? lastActivityAt : null,
        createdBy: sample.raisedBy.id,
        createdBySide: sample.raisedBy.side,
        createdAt: sample.at,
        lastActivityAt,
      })
      .returning({ id: schema.request.id });
    const stored = firstRow(inserted, 'the stored request');
    for (const entry of entries) {
      const written = { requestId: stored.id, authorId: entry.by.id, authorSide: entry.by.side };
      // eslint-disable-next-line no-await-in-loop -- Same.
      const [reply] = await db
        .insert(schema.requestEntry)
        .values(entryValues(written, entry))
        .returning({ id: schema.requestEntry.id, body: schema.requestEntry.body });
      const mentioned = 'reply' in entry ? (entry.mentions ?? []) : [];
      if (reply && mentioned.length > 0) {
        // As the service stores them: a row per person, and the text's markers point at the rows.
        // eslint-disable-next-line no-await-in-loop -- Same.
        const mentions = await db
          .insert(schema.requestMention)
          .values(
            mentioned.map((person) => ({
              requestId: stored.id,
              entryId: reply.id,
              userId: person.id,
              side: person.side,
            })),
          )
          .returning({ id: schema.requestMention.id });
        const body = mentions.reduce(
          (text, mention, place) =>
            text.replaceAll(sampleMention(place), storedMentionMarker(mention.id)),
          reply.body ?? '',
        );
        // eslint-disable-next-line no-await-in-loop -- Same.
        await db
          .update(schema.requestEntry)
          .set({ body })
          .where(eq(schema.requestEntry.id, reply.id));
      }
    }
    if (sample.assignees && sample.assignees.length > 0) {
      // eslint-disable-next-line no-await-in-loop -- Same.
      await db
        .insert(schema.requestAssignee)
        .values(sample.assignees.map((userId) => ({ requestId: stored.id, userId })));
    }
    numbers.push(number);
  }
  const lastNumber = numbers.at(-1);
  if (lastNumber !== undefined) {
    await db
      .insert(schema.requestCounter)
      .values({ lastNumber })
      .onConflictDoUpdate({ target: schema.requestCounter.singleton, set: { lastNumber } });
  }
  return numbers;
}
