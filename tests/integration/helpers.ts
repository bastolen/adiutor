/**
 * @file Helpers for integration tests: a service context on the test
 * database that captures emails, a reset between tests, a switch for GitHub
 * sign-in, factories, and reading an email's language.
 */
import { randomUUID } from 'node:crypto';

import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, expect, inject, vi } from 'vitest';

import { createDatabase, type Database, type DatabaseTransaction } from '@/db';
import {
  account,
  company,
  membership,
  passkey,
  queuedJob,
  type QueuedJobStatus,
  rateLimitBucket,
  session,
  staffSettings,
  twoFactor,
  user,
} from '@/db/schema';
import type { MfaMethod } from '@/lib/authz/mfa';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { defined, firstRow } from '@/lib/defined';
import type { Email } from '@/lib/email';
import type { Locale } from '@/lib/i18n/locales';
import { MFA_PROVIDERS, type OAuthProvider } from '@/lib/sign-in/oauth-providers';
import { availableProviders, configuredProviders } from '@/lib/sign-in/providers';
import { type Actor, loadActor } from '@/server/actor';
import type { ServiceContext } from '@/server/context';
import { type JobRunResult, runQueue } from '@/server/jobs';

import emptyDatabase from '../database/empty-database';

/** Test service context plus the emails it "sent". */
export interface TestContext {
  /** Service context on the test database. */
  ctx: ServiceContext;
  /** Database client for the test database. */
  db: Database;
  /** Emails sent during the current test. */
  sent: Email[];
}

/**
 * Creates a service context on the test database for a test file. Empties
 * the database and the captured emails before each test, turns GitHub
 * sign-in back on (see {@link turnOffGitHubSignIn}), and closes the
 * connection after the file.
 *
 * @returns The context; `sent` is cleared before each test.
 */
export function setupTestContext(): TestContext {
  const db = createDatabase(inject('databaseUrl'));
  const sent: Email[] = [];
  const ctx: ServiceContext = {
    db,
    baseUrl: 'https://adiutor.test',
    /**
     * Captures an email instead of sending it.
     *
     * @param email - The email.
     */
    sendEmail: async (email) => {
      sent.push(email);
    },
  };

  beforeEach(async () => {
    sent.length = 0;
    // Every provider that can prove MFA counts as configured again (see `turnOffGitHubSignIn`).
    availableProviders.splice(
      0,
      availableProviders.length,
      ...MFA_PROVIDERS.filter((provider) => configuredProviders[provider]),
    );
    await emptyDatabase(db);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  return { ctx, db, sent };
}

/**
 * Makes the rest of the current test run as if GitHub sign-in weren't
 * configured on this server (the integration tests configure every provider
 * that can prove MFA), so the MFA rules don't count its accounts' two-factor
 * authentication anywhere: as MFA, as a second step or as something to keep.
 * It changes `availableProviders`, which every service passes to the rules;
 * {@link setupTestContext} turns it back on before the next test.
 */
export function turnOffGitHubSignIn(): void {
  const index = availableProviders.indexOf('github');
  if (index >= 0) {
    availableProviders.splice(index, 1);
  }
}

/**
 * Creates a user.
 *
 * @param db - Test database.
 * @param email - Their email address (lower-case).
 * @returns The user's ID.
 */
export async function createUser(db: Database, email: string): Promise<string> {
  const created = firstRow(
    await db
      .insert(user)
      .values({ email, name: email.split('@')[0] ?? email, emailVerified: true })
      .returning({ id: user.id }),
    'the new user',
  );
  return created.id;
}

/**
 * Turns on two-step verification for a user: with an authenticator app (a
 * verified secret row, as Better Auth stores it), or with email codes only.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param method - `authenticator` (default) or `email`.
 */
export async function enableTwoFactor(
  db: Database,
  userId: string,
  method: 'authenticator' | 'email' = 'authenticator',
): Promise<void> {
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, userId));
  if (method === 'authenticator') {
    await db.insert(twoFactor).values({
      userId,
      secret: 'encrypted-secret',
      backupCodes: 'encrypted-codes',
      verified: true,
    });
  }
}

/**
 * Starts setting up an authenticator app without finishing it: the secret
 * row Better Auth stores before the app's first code is checked
 * (`verified: false`). It doesn't count as an authenticator app, and its
 * backup codes don't work, until a code finishes the setup.
 *
 * @param db - Test database.
 * @param userId - The user.
 */
export async function startAuthenticatorSetup(db: Database, userId: string): Promise<void> {
  await db.insert(twoFactor).values({
    userId,
    secret: 'encrypted-secret',
    backupCodes: 'encrypted-codes',
    verified: false,
  });
}

/**
 * Connects a GitHub or Google account to a user, as Better Auth stores it.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param options - Optional details.
 * @param options.providerId - `github` (default) or `google`.
 * @param options.mfaVerified - Whether the provider account has two-factor authentication;
 *   defaults to `true`.
 * @param options.confirmed - Whether it counts yet (see `beforeAccountCreate`); defaults to `true`.
 * @param options.accountName - Its name at the provider (`accountName`); none by default.
 * @param options.accessToken - Its access token; none by default.
 * @param options.updatedAt - When it was last used to sign in; defaults to now.
 * @param options.accountId - The provider's ID for the account; random by default.
 * @returns The account row's ID (what Better Auth's unlink takes).
 */
export async function connectProvider(
  db: Database,
  userId: string,
  options: {
    providerId?: OAuthProvider;
    mfaVerified?: boolean;
    confirmed?: boolean;
    accountName?: string;
    accessToken?: string;
    updatedAt?: Date;
    accountId?: string;
  } = {},
): Promise<string> {
  const providerId = options.providerId ?? 'github';
  const created = firstRow(
    await db
      .insert(account)
      .values({
        userId,
        accountId: options.accountId ?? `${providerId}-${randomUUID()}`,
        providerId,
        mfaVerified: options.mfaVerified ?? true,
        confirmed: options.confirmed ?? true,
        accountName: options.accountName,
        accessToken: options.accessToken,
        updatedAt: options.updatedAt,
      })
      .returning({ id: account.id }),
    'the new account',
  );
  return created.id;
}

/**
 * The time a number of minutes ago.
 *
 * @param minutes - How many minutes.
 * @returns That time.
 */
export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/**
 * Connects a GitHub account to a user, as Better Auth stores it.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param mfaVerified - Whether the GitHub account has two-factor authentication.
 * @returns The account row's ID.
 */
export async function connectGitHub(
  db: Database,
  userId: string,
  mfaVerified = true,
): Promise<string> {
  return connectProvider(db, userId, { mfaVerified });
}

/**
 * Gives a user a passkey, as Better Auth stores it once registration is
 * verified.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @returns The passkey's ID.
 */
export async function addPasskey(db: Database, userId: string): Promise<string> {
  const created = firstRow(
    await db
      .insert(passkey)
      .values({
        userId,
        name: 'Adiutor Tests laptop',
        publicKey: 'adiutor-tests-public-key',
        credentialID: `adiutor-tests-credential-${randomUUID()}`,
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
      })
      .returning({ id: passkey.id }),
    'the new passkey',
  );
  return created.id;
}

/**
 * Gives a user a password, as a password reset does for an account without one.
 *
 * @param db - Test database.
 * @param userId - The user.
 */
export async function addPassword(db: Database, userId: string): Promise<void> {
  await db
    .insert(account)
    .values({ userId, accountId: userId, providerId: 'credential', password: 'hashed-password' });
}

/**
 * Creates the staff's settings row (which means "set up").
 *
 * @param db - Test database.
 * @param name - The name shown to users; defaults to "Adiutor Tests".
 * @param defaultLocale - Adiutor's default language; defaults to English (US).
 */
export async function createStaffSettings(
  db: Database,
  name = 'Adiutor Tests',
  defaultLocale: Locale = 'en-US',
): Promise<void> {
  await db.insert(staffSettings).values({ name, defaultLocale });
}

/**
 * Creates a client company.
 *
 * @param db - Test database.
 * @param options - Optional details.
 * @param options.name - Company name; defaults to "Adiutor Tests".
 * @param options.slug - URL name; defaults to a unique `adiutor-tests-…`.
 * @param options.deactivated - Create it deactivated.
 * @returns The company row.
 */
export async function createCompany(
  db: Database,
  options: { name?: string; slug?: string; deactivated?: boolean } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  const created = firstRow(
    await db
      .insert(company)
      .values({
        name: options.name ?? 'Adiutor Tests',
        slug: options.slug ?? `adiutor-tests-${suffix}`,
        deactivatedAt: options.deactivated ? new Date() : null,
      })
      .returning(),
    'the new company',
  );
  return created;
}

/**
 * Uses up a rate limit the way earlier hits would have: its bucket is full
 * for the next hour.
 *
 * @param db - Test database.
 * @param key - The bucket, e.g. `invite:user:<id>`.
 * @param limit - The limit (`RATE_LIMITS.*.limit`).
 */
export async function fillRateLimitBucket(db: Database, key: string, limit: number): Promise<void> {
  await db
    .insert(rateLimitBucket)
    .values({ key, count: limit, resetAt: sql`now() + interval '1 hour'` });
}

/**
 * Reads how many hits a rate limit bucket has counted.
 *
 * @param db - Test database.
 * @param key - The bucket.
 * @returns The count, or `null` when nothing was counted.
 */
export async function rateLimitHits(db: Database, key: string): Promise<number | null> {
  const [row] = await db
    .select({ count: rateLimitBucket.count })
    .from(rateLimitBucket)
    .where(eq(rateLimitBucket.key, key));
  return row?.count ?? null;
}

/**
 * Adds a user to a client company.
 *
 * @param db - Test database.
 * @param companyId - The company.
 * @param userId - The user.
 * @param role - Their role there.
 * @returns The membership ID.
 */
export async function addMember(
  db: Database,
  companyId: string,
  userId: string,
  role: CompanyRole,
): Promise<string> {
  const created = firstRow(
    await db
      .insert(membership)
      .values({ companyId, userId, role })
      .returning({ id: membership.id }),
    'the new membership',
  );
  return created.id;
}

/**
 * Loads a user as an actor.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @returns The actor.
 */
export async function actorFor(db: Database, userId: string): Promise<Actor> {
  const actor = await loadActor(db, userId);
  if (!actor) {
    throw new Error(`No user ${userId}`);
  }
  return actor;
}

/**
 * Puts a user on the staff with a platform role.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param role - Their role on the staff.
 */
async function addToStaff(db: Database, userId: string, role: PlatformRole): Promise<void> {
  await db.update(user).set({ platformRole: role }).where(eq(user.id, userId));
}

/**
 * Creates a user on the staff with a platform role and returns them as an
 * actor.
 *
 * @param db - Test database.
 * @param role - Their role on the staff.
 * @param email - Their email; defaults to a unique one.
 * @returns The actor.
 */
export async function staffActor(
  db: Database,
  role: PlatformRole,
  email = `${role}-${randomUUID().slice(0, 8)}@adiutor.test`,
): Promise<Actor> {
  const userId = await createUser(db, email);
  await addToStaff(db, userId, role);
  return actorFor(db, userId);
}

/**
 * Creates a user with a role in a client company and returns them as an
 * actor.
 *
 * @param db - Test database.
 * @param companyId - The company.
 * @param role - Their role there.
 * @param email - Their email; defaults to a unique one.
 * @returns The actor.
 */
export async function memberActor(
  db: Database,
  companyId: string,
  role: CompanyRole,
  email = `${role}-${randomUUID().slice(0, 8)}@adiutor.test`,
): Promise<Actor> {
  const userId = await createUser(db, email);
  await addMember(db, companyId, userId, role);
  return actorFor(db, userId);
}

/**
 * Runs async steps one after another (not in parallel) and collects results.
 *
 * @param items - Inputs, in order.
 * @param run - The step to run for each input.
 * @returns The results, in input order.
 */
export async function inSequence<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  return items.reduce<Promise<R[]>>(
    async (previous, item) => [...(await previous), await run(item)],
    Promise.resolve([]),
  );
}

/**
 * Reads the language an email is written in, from its `<html lang>`.
 *
 * @param email - The email.
 * @returns The locale, e.g. `nl-NL`.
 */
export function emailLanguage(email: Email): string {
  const match = /<html[^>]*\slang="([^"]+)"/.exec(email.html);
  return defined(match?.[1], `the language of the email "${email.subject}"`);
}

/**
 * Saves a user's language (`user.locale`), as choosing one on the account
 * page will.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param locale - The language, or `null` for none.
 */
export async function setUserLocale(
  db: Database,
  userId: string,
  locale: Locale | null,
): Promise<void> {
  await db.update(user).set({ locale }).where(eq(user.id, userId));
}

/**
 * A service context whose request is in a language, as the app's is when
 * the browser asked for one (`requestLocale`).
 *
 * @param ctx - The test context.
 * @param locale - The request's language.
 * @returns The context, with `requestLocale`.
 */
export function inLanguage<C extends ServiceContext>(ctx: C, locale: Locale): C {
  return {
    ...ctx,
    /**
     * The request's language.
     *
     * @returns The locale.
     */
    requestLocale: async () => locale,
  };
}

/**
 * Extracts the invitation or invite-link token from an email's text.
 *
 * @param email - The email.
 * @returns The token.
 */
export function tokenFrom(email: Email): string {
  const match = email.text.match(/\/(?:invite|join)\/([A-Za-z0-9_-]+)/);
  if (!match) {
    throw new Error(`No link in email: ${email.subject}`);
  }
  return defined(match[1], `the token in the email "${email.subject}"`);
}

/**
 * Creates a session (signed-in device) for a user. Without `mfaMethod` it's
 * a session without a second factor, as after a password or email-link
 * sign-in.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @param options - Optional details.
 * @param options.expiresAt - When it expires; defaults to a week from now.
 * @param options.userAgent - The browser.
 * @param options.mfaMethod - The second factor its sign-in or a step-up had, which marks it
 *   MFA verified.
 * @param options.mfaVerifiedAt - When that second factor was proven; defaults to `null`.
 * @returns The session ID.
 */
export async function createSession(
  db: Database,
  userId: string,
  options: {
    expiresAt?: Date;
    userAgent?: string;
    mfaMethod?: MfaMethod;
    mfaVerifiedAt?: Date | null;
  } = {},
): Promise<string> {
  const created = firstRow(
    await db
      .insert(session)
      .values({
        userId,
        token: randomUUID(),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent: options.userAgent ?? null,
        mfaVerified: options.mfaMethod !== undefined,
        mfaMethod: options.mfaMethod ?? null,
        mfaVerifiedAt: options.mfaVerifiedAt ?? null,
      })
      .returning({ id: session.id }),
    'the new session',
  );
  return created.id;
}

/**
 * Replays two requests for one address at the same moment, in the order that
 * used to fail. `first` runs in a transaction that's held open once it's
 * done, `second` starts meanwhile, and the held transaction commits only once
 * `second` is waiting for it (for its lock, or for its uncommitted
 * invitation). Whatever happens, both have ended before this returns, so no
 * transaction or connection is left open.
 *
 * With `onceWaiting`, the held transaction does more work once `second`
 * waits for it, right before it commits: what `second` started before, and
 * finds done when it goes on.
 *
 * @param db - The test database client (from {@link setupTestContext}).
 * @param first - The first request's work in its transaction.
 * @param second - The second request.
 * @param onceWaiting - More work for the first request's transaction, once `second` waits for it.
 * @returns What `first` returned, and how `second` ended.
 */
export async function atTheSameMoment<F, S>(
  db: Database,
  first: (tx: DatabaseTransaction) => Promise<F>,
  second: () => Promise<S>,
  onceWaiting?: (tx: DatabaseTransaction) => Promise<void>,
): Promise<{ first: F; second: PromiseSettledResult<S> }> {
  const { promise: released, resolve: release } = Promise.withResolvers<boolean>();
  const { promise: held, resolve: holding } = Promise.withResolvers<number>();
  const firstDone = db.transaction(async (tx) => {
    const result = await first(tx);
    const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    holding(firstRow(rows, 'the backend process ID').pid);
    // Released early (`false`) when `second` never came to wait: nothing more to replay then.
    if (await released) {
      await onceWaiting?.(tx);
    }
    return result;
  });
  let secondDone: Promise<PromiseSettledResult<S>[]> = Promise.resolve([]);
  try {
    // `firstDone` can only end first by failing.
    const pid = await Promise.race([held, firstDone.then(() => -1)]);
    secondDone = Promise.allSettled([second()]);
    await vi.waitFor(
      async () => {
        // A second request that failed without waiting reports its own error, not a timeout.
        const [ended] = await Promise.race([secondDone, Promise.resolve([])]);
        if (ended?.status === 'rejected') {
          throw ended.reason;
        }
        const { rows } = await db.execute<{ waiting: number }>(
          sql`select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
        );
        expect(firstRow(rows, 'the waiting count').waiting).toBe(1);
      },
      { timeout: 5_000 },
    );
    release(true);
  } finally {
    release(false);
    await Promise.allSettled([firstDone, secondDone]);
  }
  const settled = firstRow(await secondDone, "the second request's result");
  return { first: await firstDone, second: settled };
}

/**
 * Reads when a user was last active.
 *
 * @param db - The test database client.
 * @param userId - The user.
 * @returns The stored `lastActiveAt`.
 */
export async function lastActiveAt(db: Database, userId: string): Promise<Date | null> {
  const found = firstRow(
    await db.select({ lastActiveAt: user.lastActiveAt }).from(user).where(eq(user.id, userId)),
    'the user',
  );
  return found.lastActiveAt;
}

/**
 * A deadline far enough away that no test reaches it, for runs that may take
 * all the time they need.
 */
export const later = new Date(Date.now() + 60 * 60_000);

/**
 * Sends what waits in the queue, as the next tick would: security notices
 * and the other queued emails. Call it before checking for an email a
 * service queues.
 *
 * @param ctx - The service context, whose `sendEmail` gets the emails.
 * @param kinds - The kinds to run; every registered kind by default.
 * @returns The runs, one per kind that ran jobs.
 */
export async function sendQueuedEmails(
  ctx: ServiceContext,
  kinds?: Parameters<typeof runQueue>[1]['kinds'],
): Promise<JobRunResult[]> {
  const { runs } = await runQueue(ctx, {
    trigger: 'tick',
    deadline: later,
    startedAt: new Date(),
    ...(kinds ? { kinds } : {}),
  });
  return runs;
}

/**
 * The context with its mail server down: every email it sends fails.
 *
 * @param ctx - The service context.
 * @returns The same context, refusing every email.
 */
export function mailDown(ctx: ServiceContext): ServiceContext {
  return {
    ...ctx,
    /** Refuses the email, as a mail server that's down would. */
    sendEmail: async () => {
      throw new Error('Adiutor Tests: the mail server is down');
    },
  };
}

/**
 * Stores a queued job directly: waiting (never tried), or tried five times
 * and, when failed or succeeded, finished now.
 *
 * @param db - The test database.
 * @param kind - Its kind's name.
 * @param status - Where it is; given up after its last attempt by default.
 * @returns Its ID.
 */
export async function storeQueuedJob(
  db: Database,
  kind: string,
  status: QueuedJobStatus = 'failed',
): Promise<string> {
  const stored = firstRow(
    await db
      .insert(queuedJob)
      .values({
        kind,
        status,
        attempts: status === 'queued' ? 0 : 5,
        finishedAt: status === 'failed' || status === 'succeeded' ? sql`now()` : null,
      })
      .returning({ id: queuedJob.id }),
    'the queued job',
  );
  return stored.id;
}

/**
 * The kinds of the jobs waiting in the queue, oldest first. Services queue
 * most emails instead of sending them, so a check that nothing was sent also
 * checks this, or it would pass whatever the service queued.
 *
 * @param db - The test database.
 * @returns The kinds, e.g. `['security-notice']`; empty when nothing waits.
 */
export async function queuedJobKinds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ kind: queuedJob.kind })
    .from(queuedJob)
    .where(eq(queuedJob.status, 'queued'))
    .orderBy(asc(queuedJob.runAt), asc(queuedJob.id));
  return rows.map(({ kind }) => kind);
}
