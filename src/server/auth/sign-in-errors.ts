/**
 * @file Sign-in errors that end on the error page (`/sign-in-error`): Better
 * Auth sends people there when signing in fails with nowhere else to go (see
 * `onAPIError` in `src/lib/auth.ts`). Each one gets a short reference that
 * the page shows, so whoever hit it can send it to an admin. The admin finds
 * the reference in the server log (with the error code) and, for
 * {@link SIGN_IN_ERROR_RETENTION_DAYS} days, in the `sign_in_error` table
 * (with Better Auth's description too).
 */
import { signInError } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import type { ServiceContext } from '../context';
import { createReference } from '../error-reference';
import { isUniqueViolation } from '../errors';
import { hitRateLimit, ipRateLimitKey, RATE_LIMITS } from '../rate-limit';

/** How many days stored sign-in errors are kept (the `retention` job deletes older ones). */
export const SIGN_IN_ERROR_RETENTION_DAYS = 7;

/** Better Auth's error codes: letters, digits, `_`, `-` and `'` (e.g. `email_doesn't_match`). */
const CODE_PATTERN = /^[A-Za-z0-9_'-]{1,100}$/;

/** The longest description that is stored. */
const MAX_DESCRIPTION_LENGTH = 500;

/** How often a reference is drawn again when it's taken already (practically never). */
const REFERENCE_ATTEMPTS = 3;

/**
 * Checks a code from the URL again (Better Auth sanitizes it, but the page
 * can be opened with anything).
 *
 * @param code - The `error` query parameter, if any.
 * @returns The code, or `UNKNOWN` when it's missing or doesn't look like one.
 */
export function cleanErrorCode(code: string | null | undefined): string {
  return code && CODE_PATTERN.test(code) ? code : 'UNKNOWN';
}

/** A recorded sign-in error, as the page shows it. */
export interface RecordedSignInError {
  /** The reference to send to an admin. */
  reference: string;
  /** When it happened. */
  at: Date;
}

/**
 * Stores a sign-in error under a new reference, drawing another one if it's
 * taken.
 *
 * @param ctx - Service context.
 * @param row - What to store.
 * @param row.code - The checked code.
 * @param row.description - The shortened description, or `null`.
 * @param row.userId - Who was signed in, or `null`.
 * @param attempt - How many references were tried already.
 * @returns The stored reference and its time.
 */
async function store(
  ctx: ServiceContext,
  row: { code: string; description: string | null; userId: string | null },
  attempt = 1,
): Promise<RecordedSignInError> {
  try {
    const stored = firstRow(
      await ctx.db
        .insert(signInError)
        .values({ ...row, reference: createReference() })
        .returning({ reference: signInError.reference, at: signInError.createdAt }),
      'the stored sign-in error',
    );
    return stored;
  } catch (error) {
    if (isUniqueViolation(error) && attempt < REFERENCE_ATTEMPTS) {
      return store(ctx, row, attempt + 1);
    }
    throw error;
  }
}

/**
 * Records a sign-in error that ended on the error page: one line in the
 * server log with the reference and the code (nothing personal), and a row
 * with the description and who was signed in, if anyone. The rows are
 * limited per IP address (`RATE_LIMITS.signInErrorsPerIp`), so opening the
 * page over and over can't fill the table; past the limit the error is only
 * logged, with its reference.
 *
 * @param ctx - Service context; `requestInfo` gives the IP address for the limit.
 * @param error - The error.
 * @param error.code - Better Auth's error code (checked again).
 * @param error.description - Better Auth's description, if any (shortened).
 * @param error.userId - Who is signed in, if anyone.
 * @returns The reference and when it happened.
 */
export async function recordSignInError(
  ctx: ServiceContext,
  error: { code: string | null | undefined; description?: string | null; userId?: string | null },
): Promise<RecordedSignInError> {
  const code = cleanErrorCode(error.code);
  const description = error.description?.trim().slice(0, MAX_DESCRIPTION_LENGTH) || null;
  const key = await ipRateLimitKey(ctx, 'sign-in-error');
  const { allowed } = await hitRateLimit(ctx, key, RATE_LIMITS.signInErrorsPerIp);

  let recorded: RecordedSignInError = { reference: createReference(), at: new Date() };
  if (allowed) {
    recorded = await store(ctx, { code, description, userId: error.userId ?? null });
  }
  // eslint-disable-next-line no-console -- The reference and code only: the description may name someone, and logs never do.
  console.warn(`Sign-in error ${recorded.reference}: ${code}`);
  return recorded;
}
