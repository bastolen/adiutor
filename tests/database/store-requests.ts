/**
 * @file Stores example requests with their history, for the seeds: the
 * development seed (`scripts/seed-dev.ts`) and the end-to-end seed
 * (`e2e/support/seed.ts`). They're written straight to the tables, with the
 * times the examples say, and the request counter is left at the last
 * number, so requests raised afterwards continue from it.
 */
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import * as schema from '../../src/db/schema';
import { firstRow } from '../../src/lib/defined';
import {
  isClosedStatus,
  type RequestPriority,
  type RequestSide,
  type RequestStatus,
  type RequestTextFormat,
  type RequestType,
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

/** One entry of an example request's history: a reply, or a change. */
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
    }
  | {
      /** What changed. */
      change: 'status' | 'title' | 'type' | 'priority';
      /** What it was. */
      from: string;
      /** What it became. */
      to: string;
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
  type: RequestType;
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
}

/**
 * Stores example requests, numbered in the order given, and sets the request
 * counter to the last number.
 *
 * Each request's last activity is its latest entry the company sees (every
 * one but a change of priority), or the moment it was raised. A reopened
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
      await db.insert(schema.requestEntry).values(
        'reply' in entry
          ? {
              ...written,
              kind: 'comment',
              body: entry.reply,
              bodyFormat: entry.format,
              createdAt: entry.at,
            }
          : {
              ...written,
              kind: entry.change,
              fromValue: entry.from,
              toValue: entry.to,
              createdAt: entry.at,
            },
      );
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
