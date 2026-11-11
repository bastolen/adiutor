/**
 * @file Sample errors for local development, so Logs → Errors has something
 * to show: errors on the server (one of them stored three times under the
 * same reference, as a repeated error is), errors in the browser and failed
 * sign-ins, from the last few days. Used by `scripts/seed-dev.ts`. They're
 * stored the way the app stores real ones (`src/server/app-errors.ts`,
 * `src/server/auth/sign-in-errors.ts`): references from the digest or drawn
 * at random, page paths without tokens, messages without personal data.
 */
import type * as schema from '../src/db/schema';
import { referenceFromDigest } from '../src/lib/error-reference';
import { createReference } from '../src/server/auth/sign-in-errors';

/** An hour in milliseconds. */
const HOUR = 60 * 60 * 1000;

/** The seeded users the samples name as signed in; any of them may be missing. */
export interface SampleErrorUsers {
  /** Alex Admin (`admin@adiutor.test`). */
  admin?: string | null;
  /** Morgan Manager (`manager@adiutor.test`). */
  manager?: string | null;
  /** Sam Support (`support@adiutor.test`). */
  support?: string | null;
  /** Avery Alpha (`alpha.admin@adiutor.test`). */
  alphaAdmin?: string | null;
  /** Mika Multi (`multi@adiutor.test`). */
  multi?: string | null;
}

/** Rows to insert into `app_error` and `sign_in_error`. */
export interface SampleErrors {
  /** Errors on the server and in the browser. */
  appErrors: (typeof schema.appError.$inferInsert)[];
  /** Failed sign-ins. */
  signInErrors: (typeof schema.signInError.$inferInsert)[];
}

/** The digest of the server error that happened three times. */
const REPEATED_DIGEST = '2828711936';

/**
 * Builds the sample errors, all from the last 6 days, so they show in
 * "Last 7 days" until `pnpm jobs:run` removes them. Sign-in references are
 * drawn at random each time (they're unique in the table); server errors'
 * come from their digest, so adding them again stores the same errors again.
 *
 * @param users - IDs of the seeded users to name as signed in (`null` when missing).
 * @returns The rows.
 */
export function sampleErrors(users: SampleErrorUsers): SampleErrors {
  const now = new Date();
  /**
   * A time some hours before `now`.
   *
   * @param hours - How many hours before.
   * @returns The time.
   */
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * HOUR);

  /**
   * An error on the server, with its reference taken from its digest.
   *
   * @param digest - Next's digest of the error.
   * @param fields - Where it happened, what it was, who was signed in and when.
   * @returns The row.
   */
  const serverError = (
    digest: string,
    fields: Omit<typeof schema.appError.$inferInsert, 'reference' | 'digest' | 'source'>,
  ): typeof schema.appError.$inferInsert => ({
    reference: referenceFromDigest(digest),
    digest,
    source: 'server',
    ...fields,
  });

  /** The company page error, happening again and again for the same person. */
  const companyPageError = {
    routeType: 'render',
    routePath: '/(app)/companies/[companyId]/page',
    path: '/companies/adiutor-tests-alpha',
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'name')",
    userId: users.alphaAdmin ?? null,
  } as const;

  return {
    appErrors: [
      serverError(REPEATED_DIGEST, { ...companyPageError, createdAt: hoursAgo(2) }),
      serverError(REPEATED_DIGEST, { ...companyPageError, createdAt: hoursAgo(26) }),
      serverError(REPEATED_DIGEST, { ...companyPageError, createdAt: hoursAgo(73) }),
      serverError('1593400672', {
        routeType: 'action',
        routePath: '/(app)/admin/staff/page',
        path: '/admin/staff',
        name: 'Error',
        message: 'Connection terminated unexpectedly',
        userId: users.admin ?? null,
        createdAt: hoursAgo(5),
      }),
      serverError('3901176254', {
        routeType: 'route',
        routePath: '/api/auth/[...all]/route',
        path: '/api/auth/callback/github',
        name: 'TypeError',
        message: 'fetch failed',
        userId: null,
        createdAt: hoursAgo(30),
      }),
      serverError('774205129', {
        routeType: 'render',
        routePath: '/invite/[token]/page',
        // The token is taken out of stored paths (`recordedPath`).
        path: '/invite/[token]',
        name: 'Error',
        message: 'Failed query: select "id", "email" from "invitation" where "token_hash" = $1',
        userId: null,
        createdAt: hoursAgo(50),
      }),
      serverError('2105836617', {
        routeType: 'proxy',
        routePath: '/proxy',
        path: '/companies',
        name: 'TypeError',
        message: 'Invalid URL',
        userId: null,
        createdAt: hoursAgo(98),
      }),
      {
        reference: createReference(),
        source: 'browser',
        path: '/account/security',
        name: 'ChunkLoadError',
        message: 'Loading chunk 4521 failed.',
        userId: users.multi ?? null,
        createdAt: hoursAgo(1),
      },
      {
        reference: createReference(),
        source: 'browser',
        path: '/dashboard',
        name: 'TypeError',
        message: 'Failed to fetch',
        userId: users.support ?? null,
        createdAt: hoursAgo(140),
      },
    ],
    signInErrors: [
      {
        reference: createReference(),
        code: 'state_mismatch',
        description: 'State mismatch',
        userId: null,
        createdAt: hoursAgo(3),
      },
      {
        reference: createReference(),
        code: 'access_denied',
        description: 'The user denied access',
        userId: null,
        createdAt: hoursAgo(28),
      },
      {
        reference: createReference(),
        code: 'account_already_linked_to_different_user',
        description: 'Account already linked to a different user',
        userId: users.manager ?? null,
        createdAt: hoursAgo(54),
      },
      {
        reference: createReference(),
        code: 'email_not_found',
        description: 'Email not found',
        userId: null,
        createdAt: hoursAgo(120),
      },
    ],
  };
}
