/**
 * @file Drizzle schema for webhooks: the addresses staff Admins have Adiutor
 * send what happens to requests to, the request types each one covers, and
 * the deliveries sent to them. The values of the format, event, reason,
 * status and error columns live in `src/lib/webhooks.ts`.
 *
 * A webhook's address and signing secret are stored sealed
 * (`src/server/sealed-secrets.ts`): a chat app's address is itself a secret.
 * A delivery holds the IDs of what it tells of, never a text or a name: what
 * it sends is read when it's sent.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_ERROR_KINDS,
  WEBHOOK_EVENTS,
  WEBHOOK_FORMATS,
  WEBHOOK_OFF_REASONS,
  type WebhookEvent,
} from '../../lib/webhooks';
import { user } from './auth';
import { createdAt, id, oneOf, timestampTz } from './columns';
import { request, requestType } from './requests';

/** The events, as an SQL array for the check on a webhook's events. */
const EVENTS_ARRAY = `array[${WEBHOOK_EVENTS.map((event) => `'${event}'`).join(', ')}]::text[]`;

/** An address staff Admins have Adiutor send what happens to requests to. */
export const webhook = pgTable(
  'webhook',
  {
    id: id(),
    /** What the staff call it, shown in Settings and in the email when it's turned off. */
    name: text('name').notNull(),
    /** Its address, sealed: it can hold a token (a chat app's address always does). */
    urlSealed: text('url_sealed').notNull(),
    /** The address's host (and port), the only part of it shown again. */
    urlHost: text('url_host').notNull(),
    /** How it's sent (`WEBHOOK_FORMATS`). */
    format: text('format', { enum: WEBHOOK_FORMATS }).notNull(),
    /** What it's told about (`WEBHOOK_EVENTS`), at least one. */
    events: text('events').array().$type<WebhookEvent[]>().notNull(),
    /**
     * Whether it covers every request type, new ones too; otherwise only the
     * types in `webhook_request_type`.
     */
    allTypes: boolean('all_types').default(true).notNull(),
    /** Its signing secret (`whsec_…`), sealed; shown once when it's made. */
    secretSealed: text('secret_sealed').notNull(),
    /** When its secret was last renewed, or `null` while it has its first. */
    secretRenewedAt: timestampTz('secret_renewed_at'),
    /** When it was turned off, or `null` while it's on. */
    turnedOffAt: timestampTz('turned_off_at'),
    /** Why it's off (`WEBHOOK_OFF_REASONS`), exactly while it is. */
    turnedOffReason: text('turned_off_reason', { enum: WEBHOOK_OFF_REASONS }),
    /** The staff Admin who turned it off, while their account exists; `null` when Adiutor did. */
    turnedOffBy: uuid('turned_off_by').references(() => user.id, { onDelete: 'set null' }),
    /**
     * Since when its deliveries have done nothing but fail, or `null` after
     * one went through; three days of it turn the webhook off.
     */
    failingSince: timestampTz('failing_since'),
    /** The staff Admin who added it, while their account exists. */
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    /** When a staff Admin last changed it, or `null` while it's as it was added. */
    updatedAt: timestampTz('updated_at'),
  },
  (table) => [
    index('webhook_turned_off_by_idx').on(table.turnedOffBy),
    index('webhook_created_by_idx').on(table.createdBy),
    oneOf('webhook_format_valid', table.format, WEBHOOK_FORMATS),
    oneOf('webhook_turned_off_reason_valid', table.turnedOffReason, WEBHOOK_OFF_REASONS),
    check(
      'webhook_events_valid',
      sql`${table.events} <@ ${sql.raw(EVENTS_ARRAY)} and cardinality(${table.events}) > 0`,
    ),
    /** A webhook that's off says why, and one that's on has no reason. */
    check(
      'webhook_turned_off_has_reason',
      sql`(${table.turnedOffAt} is null) = (${table.turnedOffReason} is null)`,
    ),
  ],
);

/** A request type a webhook covers, for a webhook that doesn't cover them all. */
export const webhookRequestType = pgTable(
  'webhook_request_type',
  {
    id: id(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    /** The type's key, which never changes; types are never deleted, only archived. */
    requestTypeKey: text('request_type_key')
      .notNull()
      .references(() => requestType.key),
  },
  (table) => [
    /** Each type once per webhook; also serves the webhook foreign key. */
    uniqueIndex('webhook_request_type_webhook_type_idx').on(table.webhookId, table.requestTypeKey),
    index('webhook_request_type_type_idx').on(table.requestTypeKey),
  ],
);

/**
 * One delivery to a webhook: the news about one request that one tick had
 * for it, or a test. Its attempts are counted here, each with its result,
 * never the receiver's answer.
 */
export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: id(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    /** The request it tells of; `null` for a test. */
    requestId: uuid('request_id').references(() => request.id, { onDelete: 'cascade' }),
    /** Whether it's a test a staff Admin sent, which tells of no request. */
    test: boolean('test').default(false).notNull(),
    /**
     * What it tells of, in order: each event (`WEBHOOK_EVENTS`) with the
     * entry of the request's history it's about (`null` for `raised`). IDs
     * only: the texts and names are read when it's sent.
     */
    news: jsonb('news')
      .$type<{ event: WebhookEvent; entryId: string | null }[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    /** Where it stands (`WEBHOOK_DELIVERY_STATUSES`). */
    status: text('status', { enum: WEBHOOK_DELIVERY_STATUSES }).default('pending').notNull(),
    /** How many attempts have a result recorded. */
    attempts: integer('attempts').default(0).notNull(),
    /** When the next attempt is due, while it's pending. */
    nextAttemptAt: timestampTz('next_attempt_at'),
    /** When the last attempt was made. */
    lastAttemptAt: timestampTz('last_attempt_at'),
    /** The status the receiver last answered with, if it answered. */
    lastStatus: integer('last_status'),
    /** How the last attempt failed (`WEBHOOK_ERROR_KINDS`), or `null` when it didn't. */
    lastError: text('last_error', { enum: WEBHOOK_ERROR_KINDS }),
    /** How long the last attempt took, in milliseconds. */
    lastDurationMs: integer('last_duration_ms'),
    /** When the receiver took it. */
    deliveredAt: timestampTz('delivered_at'),
    createdAt: createdAt(),
  },
  (table) => [
    /** A webhook's deliveries, newest last; also serves the webhook foreign key. */
    index('webhook_delivery_webhook_idx').on(table.webhookId, table.id),
    index('webhook_delivery_request_idx').on(table.requestId),
    /** For the retention job, which deletes deliveries after 30 days. */
    index('webhook_delivery_created_at_idx').on(table.createdAt),
    oneOf('webhook_delivery_status_valid', table.status, WEBHOOK_DELIVERY_STATUSES),
    oneOf('webhook_delivery_last_error_valid', table.lastError, WEBHOOK_ERROR_KINDS),
    /** A test tells of no request; every other delivery tells of one. */
    check(
      'webhook_delivery_test_has_no_request',
      sql`${table.test} = (${table.requestId} is null)`,
    ),
  ],
);
