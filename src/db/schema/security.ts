/**
 * @file Drizzle schema for the audit log, sign-in errors, other errors in
 * the app and the app's own rate limits.
 */
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { AuditAction } from '../../lib/audit-actions';
import { user } from './auth';
import { createdAt, id, timestampTz } from './columns';
import { company } from './companies';

/**
 * The audit log: who did what, when and from where. References are cleared
 * (not cascaded) when a user or company is deleted, so the history stays;
 * `details` keeps names and emails for that.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: id(),
    at: timestampTz('at').defaultNow().notNull(),
    /** What happened; see `src/lib/audit-actions.ts`. */
    action: text('action').$type<AuditAction>().notNull(),
    /** Who did it (`null` for the system or a signed-out visitor). */
    actorUserId: uuid('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Whose account it was about, if any. */
    targetUserId: uuid('target_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Which company it was about, if any. */
    companyId: uuid('company_id').references(() => company.id, { onDelete: 'set null' }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** Extra facts, e.g. the role before and after, or the email at the time. */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('audit_event_at_idx').on(table.at),
    // A user's newest events by or about them are the end of these ranges: read backwards, no sort
    // (the user page's activity, and the Account page's, `src/server/audit.ts`).
    index('audit_event_actor_idx').on(table.actorUserId, table.at, table.id),
    index('audit_event_target_idx').on(table.targetUserId, table.at, table.id),
    index('audit_event_company_idx').on(table.companyId),
  ],
);

/**
 * Sign-in errors that ended on the error page (`/sign-in-error`), for
 * admins: the page shows the reference, which they look up here or in the
 * server log. Rows are deleted after 7 days (`cleanUp` in
 * `src/server/jobs.ts`).
 */
export const signInError = pgTable(
  'sign_in_error',
  {
    id: id(),
    /** The short reference shown on the page, e.g. `7KQ2-M9XD`. */
    reference: text('reference').notNull(),
    /** Better Auth's error code, e.g. `state_mismatch`. */
    code: text('code').notNull(),
    /** Better Auth's description of the error, if it gave one (shortened). */
    description: text('description'),
    /** Who was signed in when it happened, if anyone. */
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sign_in_error_reference_idx').on(table.reference),
    index('sign_in_error_user_idx').on(table.userId),
    index('sign_in_error_created_at_idx').on(table.createdAt),
  ],
);

/** Where an error in the app happened: on the server, or in the browser. */
export type AppErrorSource = 'server' | 'browser';

/**
 * What the server was doing when an error happened, as Next.js reports it to
 * `onRequestError`: rendering a page (`render`), running a server action
 * (`action`), a route handler (`route`) or the proxy (`proxy`).
 */
export type AppErrorRouteType = 'render' | 'action' | 'route' | 'proxy';

/**
 * Unexpected errors in the app (pages, server actions, route handlers, and
 * pages that failed in the browser), for admins: the error page shows the
 * reference, which they look up here or in the server log. Recorded by
 * `recordAppError` (`src/server/app-errors.ts`); rows are deleted after 7
 * days (`cleanUp` in `src/server/jobs.ts`).
 */
export const appError = pgTable(
  'app_error',
  {
    id: id(),
    /**
     * The reference shown on the error page, e.g. `7KQ2-M9XD`. Taken from
     * the digest, so the same error happening again is stored again under
     * the same reference: references aren't unique.
     */
    reference: text('reference').notNull(),
    /** Next's digest of the error, if it has one (errors from the server do). */
    digest: text('digest'),
    /** Where it happened. */
    source: text('source').$type<AppErrorSource>().notNull(),
    /** What the server was doing (server errors only). */
    routeType: text('route_type').$type<AppErrorRouteType>(),
    /** The route's file path, e.g. `/(app)/companies/[companyId]/page` (server errors only). */
    routePath: text('route_path'),
    /** The page's path, without its query string and with secret tokens taken out. */
    path: text('path'),
    /** The error's class name, e.g. `TypeError`. */
    name: text('name'),
    /** The error's message, without database values, shortened. */
    message: text('message'),
    /** Who was signed in when it happened, if anyone. */
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('app_error_reference_idx').on(table.reference),
    index('app_error_user_idx').on(table.userId),
    index('app_error_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Fixed-window counters for the app's own rate limits (sending invitations,
 * claiming invite links, step-up codes). One row per key; the window
 * restarts once `reset_at` has passed.
 */
export const rateLimitBucket = pgTable(
  'rate_limit_bucket',
  {
    id: id(),
    /** What's limited, e.g. `invite:user:<id>`. */
    key: text('key').notNull(),
    count: integer('count').notNull(),
    resetAt: timestampTz('reset_at').notNull(),
  },
  (table) => [
    uniqueIndex('rate_limit_bucket_key_idx').on(table.key),
    index('rate_limit_bucket_reset_idx').on(table.resetAt),
  ],
);
