/**
 * @file Unexpected errors in the app: those pages, server actions, route
 * handlers and the proxy throw on the server (reported by Next.js to
 * `onRequestError` in `src/instrumentation.ts`), and those that break a page
 * in the browser (reported by the error page, `src/app/report-error-action.ts`).
 *
 * The error page shows a reference such as `7KQ2-M9XD` for users to send to
 * an admin. Server errors take theirs from Next's digest
 * (`referenceFromDigest`), so the page knows it without asking; browser
 * errors draw one here and the page shows what comes back. The admin finds
 * the reference in the server log and, for {@link APP_ERROR_RETENTION_DAYS}
 * days, in the `app_error` table, with where it happened, the error's
 * message (without database values) and who was signed in.
 */
import { type AppErrorRouteType, type AppErrorSource, appError } from '@/db/schema';
import { withoutControlCharacters } from '@/lib/character-rules';
import { firstRow } from '@/lib/defined';
import { referenceFromDigest } from '@/lib/error-reference';
import {
  ERROR_MESSAGE_MAX_LENGTH,
  ERROR_NAME_MAX_LENGTH,
  ERROR_PATH_MAX_LENGTH,
} from '@/lib/input-rules';
import { redactLogValue } from '@/lib/log-redaction';

import type { ServiceContext } from './context';
import { createReference } from './error-reference';
import { hitRateLimit, ipRateLimitKey, RATE_LIMITS } from './rate-limit';

/** How many days stored errors are kept (the `retention` job deletes older ones). */
export const APP_ERROR_RETENTION_DAYS = 7;

/**
 * Paths whose next segment is a secret token: invitations, invite links and
 * Better Auth's password reset links. The token is never stored or logged.
 */
const SECRET_PATH_PREFIXES = ['/invite/', '/join/', '/api/auth/reset-password/'] as const;

/** An error to record. */
export interface AppErrorReport {
  /** Where it happened. */
  source: AppErrorSource;
  /** The thrown value, or `{ name, message }` as the browser reported it. */
  error: unknown;
  /** Next's digest of the error, if it has one; the reference is taken from it. */
  digest?: string | null;
  /** What the server was doing (server errors only). */
  routeType?: AppErrorRouteType | null;
  /** The route's file path (server errors), or the job's name (job errors). */
  routePath?: string | null;
  /** The page's path; its query string and secret tokens are taken out. */
  path?: string | null;
  /** Who was signed in, if anyone. */
  userId?: string | null;
}

/** A recorded error, as the error page shows it. */
export interface RecordedAppError {
  /** The reference to send to an admin. */
  reference: string;
  /** When it happened. */
  at: Date;
}

/**
 * Makes a text one line, trims it and cuts it to a length. Every run of
 * control characters (line breaks among them) becomes a space, since some of
 * these texts come from whoever sends a request: a path with a line break
 * would otherwise add a line to the log that looks like another error.
 *
 * @param text - The text, if any.
 * @param length - The longest it may be.
 * @returns The text, or `null` when there's nothing left.
 */
function shorten(text: string | null | undefined, length: number): string | null {
  const oneLine = withoutControlCharacters(text ?? '', ' ');
  return oneLine.trim().slice(0, length) || null;
}

/**
 * The page path as it's stored and logged: without its query string or
 * fragment (they can hold search terms and sign-in tokens), with the token
 * of a secret link replaced by `[token]`, on one line and shortened.
 *
 * @param path - The path, e.g. `/companies?q=adiutor`.
 * @returns The path, e.g. `/companies`, or `null` when there's none.
 */
export function recordedPath(path: string | null | undefined): string | null {
  const [withoutQuery = ''] = (path ?? '').split(/[?#]/, 1);
  const prefix = SECRET_PATH_PREFIXES.find((secret) =>
    withoutQuery.toLowerCase().startsWith(secret),
  );
  const cleaned = prefix
    ? `${withoutQuery.slice(0, prefix.length)}[token]${withoutQuery.slice(prefix.length).replace(/^[^/]*/, '')}`
    : withoutQuery;
  return shorten(cleaned, ERROR_PATH_MAX_LENGTH);
}

/**
 * Reads an error's class name and message, with database values taken out
 * (`redactLogValue`): a failed query's parameters, and Postgres's `detail`.
 *
 * @param error - The thrown value, or `{ name, message }` from the browser.
 * @returns The name and message, each `null` when there's none.
 */
function describeError(error: unknown): { name: string | null; message: string | null } {
  const redacted = redactLogValue(error);
  if (redacted instanceof Error) {
    return { name: redacted.name, message: redacted.message };
  }
  if (typeof redacted === 'object' && redacted !== null) {
    const { name, message } = redacted as Record<string, unknown>;
    return {
      name: typeof name === 'string' ? name : null,
      message: typeof message === 'string' ? message : null,
    };
  }
  return { name: null, message: redacted === undefined ? null : String(redacted) };
}

/**
 * Records an unexpected error: one line in the server log with the
 * reference, where it happened and the digest (nothing personal, and never a
 * line break, whatever the request sent), written first, so it's there even
 * when the database isn't; then a row with the error's name and message
 * (database values taken out, on one line, shortened) and who was signed in.
 * The rows are limited per IP address
 * (`RATE_LIMITS.appErrorsPerIp`), so errors can't be used to fill the table;
 * past the limit the error is only logged. Errors of background jobs have no
 * IP address and no visitor who could cause them, so they're never limited:
 * there are only so many jobs per tick.
 *
 * @param ctx - Service context: the database, and `requestInfo` for the IP
 *   address the limit counts.
 * @param report - The error and where it happened.
 * @returns The reference, when it happened, and whether it was stored.
 * @throws {Error} When the database can't be reached (the line is logged already).
 */
export async function recordAppError(
  ctx: Pick<ServiceContext, 'db' | 'requestInfo'>,
  report: AppErrorReport,
): Promise<RecordedAppError & { stored: boolean }> {
  const digest = shorten(report.digest, ERROR_NAME_MAX_LENGTH);
  const reference = digest ? referenceFromDigest(digest) : createReference();
  const routePath = shorten(report.routePath, ERROR_NAME_MAX_LENGTH);
  const path = recordedPath(report.path);

  const where = [report.source, report.routeType, routePath ?? path].filter(Boolean).join(' ');
  // eslint-disable-next-line no-console -- Where it happened only: the message may name someone, and logs never do.
  console.warn(`App error ${reference}: ${where}${digest ? ` (digest ${digest})` : ''}`);

  const key = await ipRateLimitKey(ctx, 'app-error');
  const allowed =
    report.source === 'job' || (await hitRateLimit(ctx, key, RATE_LIMITS.appErrorsPerIp)).allowed;
  if (!allowed) {
    return { reference, at: new Date(), stored: false };
  }

  const { name, message } = describeError(report.error);
  const stored = firstRow(
    await ctx.db
      .insert(appError)
      .values({
        reference,
        digest,
        source: report.source,
        routeType: report.routeType ?? null,
        routePath,
        path,
        name: shorten(name, ERROR_NAME_MAX_LENGTH),
        message: shorten(message, ERROR_MESSAGE_MAX_LENGTH),
        userId: report.userId ?? null,
      })
      .returning({ at: appError.createdAt }),
    'the stored error',
  );
  return { reference, at: stored.at, stored: true };
}
