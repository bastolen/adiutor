/**
 * @file Reading back the errors the app records (`app-errors.ts` for errors
 * on the server and in the browser, `auth/sign-in-errors.ts` for sign-in
 * errors), for staff Admins: looking up the reference an error page showed,
 * and listing what was recorded in the last 7 days (rows aren't kept longer).
 * Both kinds are read as one list, newest first.
 */
import { count, eq, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';

import type { DatabaseOrTransaction } from '@/db';
import {
  appError,
  type AppErrorRouteType,
  type AppErrorSource,
  signInError,
  user,
} from '@/db/schema';
import { parseErrorReference } from '@/lib/error-reference';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import { ERRORS_TABLE, type ErrorSort } from '@/lib/tables/tables';

import { assertPermission, getGlobalPermissions } from './access';
import type { Actor } from './actor';
import type { ServiceContext } from './context';
import { orderTerms, paginate } from './pagination';

/** One recorded error, of either kind. */
export interface RecordedError {
  /** Row ID. */
  id: string;
  /** An error on the server or in the browser (`app`), or a failed sign-in (`sign-in`). */
  kind: 'app' | 'sign-in';
  /** The reference the error page showed. */
  reference: string;
  /** When it was recorded. */
  at: Date;
  /** App errors: where it happened. */
  source: AppErrorSource | null;
  /** App errors on the server: what was rendering or running. */
  routeType: AppErrorRouteType | null;
  /** App errors on the server: the route's file path, e.g. `/(app)/companies/page`. */
  routePath: string | null;
  /** App errors: the page's path, without its query, with secret tokens as `[token]`. */
  path: string | null;
  /** App errors: the error's class name. */
  name: string | null;
  /** App errors: the error's message, with database values taken out. */
  message: string | null;
  /** App errors on the server: Next's digest, to find the stack in the server log. */
  digest: string | null;
  /** Sign-in errors: Better Auth's error code. */
  code: string | null;
  /** Sign-in errors: Better Auth's description. */
  description: string | null;
  /** Who was signed in, if anyone (and the account still exists). */
  user: { id: string; name: string; email: string } | null;
}

/** What {@link findErrorReference} found. */
export interface ReferenceLookup {
  /** The reference as stored, or `null` when the input can't be a reference. */
  reference: string | null;
  /** The errors recorded under it, newest first (a server error's reference can repeat). */
  errors: RecordedError[];
}

/**
 * Both kinds of error as one query with the same columns (each kind leaves
 * the other's columns empty), optionally narrowed to one reference.
 *
 * @param db - Database client.
 * @param reference - Only errors with this reference, if given.
 * @returns The subquery, as `errors`.
 */
function bothKinds(db: DatabaseOrTransaction, reference?: string) {
  const empty = sql<string | null>`null::text`;
  const appErrors = db
    .select({
      id: appError.id,
      kind: sql<RecordedError['kind']>`'app'`.as('kind'),
      reference: appError.reference,
      at: appError.createdAt,
      source: sql<AppErrorSource | null>`${appError.source}`.as('source'),
      routeType: appError.routeType,
      routePath: appError.routePath,
      path: appError.path,
      name: appError.name,
      message: appError.message,
      digest: appError.digest,
      code: empty.as('code'),
      description: empty.as('description'),
      userId: appError.userId,
    })
    .from(appError)
    .where(reference === undefined ? undefined : eq(appError.reference, reference));
  const signInErrors = db
    .select({
      id: signInError.id,
      kind: sql<RecordedError['kind']>`'sign-in'`.as('kind'),
      reference: signInError.reference,
      at: signInError.createdAt,
      source: sql<AppErrorSource | null>`null::text`.as('source'),
      routeType: sql<AppErrorRouteType | null>`null::text`.as('route_type'),
      routePath: empty.as('route_path'),
      path: empty.as('path'),
      name: empty.as('name'),
      message: empty.as('message'),
      digest: empty.as('digest'),
      code: sql<string | null>`${signInError.code}`.as('code'),
      description: signInError.description,
      userId: signInError.userId,
    })
    .from(signInError)
    .where(reference === undefined ? undefined : eq(signInError.reference, reference));
  return unionAll(appErrors, signInErrors).as('errors');
}

/**
 * Loads errors of both kinds with the signed-in user's name, newest first
 * (or oldest first), a slice at a time.
 *
 * @param db - Database client.
 * @param options - Which errors and which slice.
 * @param options.reference - Only errors with this reference, if given.
 * @param options.limit - How many to return.
 * @param options.offset - How many to skip.
 * @param options.dir - Newest first (`desc`) or oldest first.
 * @returns The errors.
 */
async function queryErrors(
  db: DatabaseOrTransaction,
  options: { reference?: string; limit: number; offset: number; dir: 'asc' | 'desc' },
): Promise<RecordedError[]> {
  const errors = bothKinds(db, options.reference);
  const rows = await db
    .select({
      id: errors.id,
      kind: errors.kind,
      reference: errors.reference,
      at: errors.at,
      source: errors.source,
      routeType: errors.routeType,
      routePath: errors.routePath,
      path: errors.path,
      name: errors.name,
      message: errors.message,
      digest: errors.digest,
      code: errors.code,
      description: errors.description,
      user: { id: user.id, name: user.name, email: user.email },
    })
    .from(errors)
    .leftJoin(user, eq(user.id, errors.userId))
    .orderBy(...orderTerms(options.dir, errors.at, errors.id))
    .limit(options.limit)
    .offset(options.offset);
  return rows.map(({ user: signedIn, ...error }) => ({
    ...error,
    user: signedIn?.id ? signedIn : null,
  }));
}

/**
 * Looks up the errors recorded under a reference, as someone typed or
 * pasted it (case, spaces and dashes don't matter). Staff Admins
 * (`errors:view`) only.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `errors:view`.
 * @param input - The reference as typed.
 * @returns The reference as stored and its errors (none when it's older than 7 days, unknown or
 *   not a reference).
 * @throws {ServiceError} `forbidden` without `errors:view`.
 */
export async function findErrorReference(
  ctx: ServiceContext,
  actor: Actor,
  input: string,
): Promise<ReferenceLookup> {
  assertPermission(getGlobalPermissions(actor), 'errors:view');
  const reference = parseErrorReference(input);
  if (!reference) {
    return { reference: null, errors: [] };
  }
  // A handful at most: one per occurrence of the same server error in 7 days.
  const errors = await queryErrors(ctx.db, { reference, limit: 100, offset: 0, dir: 'desc' });
  return { reference, errors };
}

/**
 * Lists the errors recorded in the last 7 days, both kinds together, a page
 * at a time, newest first by default. Staff Admins (`errors:view`) only.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `errors:view`.
 * @param table - The table's sort and page.
 * @returns One page of errors, and how many there are in all.
 * @throws {ServiceError} `forbidden` without `errors:view`.
 */
export async function listRecentErrors(
  ctx: ServiceContext,
  actor: Actor,
  table: Partial<TableState<ErrorSort>> = {},
): Promise<Paged<RecordedError>> {
  assertPermission(getGlobalPermissions(actor), 'errors:view');
  const state = resolveTableState(ERRORS_TABLE, table);
  return paginate(
    state,
    async () => {
      const [apps, signIns] = await Promise.all([
        ctx.db.select({ total: count() }).from(appError),
        ctx.db.select({ total: count() }).from(signInError),
      ]);
      return (apps[0]?.total ?? 0) + (signIns[0]?.total ?? 0);
    },
    (limit, offset) => queryErrors(ctx.db, { limit, offset, dir: state.dir }),
  );
}
