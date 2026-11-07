/**
 * @file Helpers for integration tests: a service context on the test
 * database that captures emails, a reset between tests, a switch for GitHub
 * sign-in, and factories.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, expect, inject, vi } from 'vitest';

import { createDatabase, type Database, type DatabaseTransaction } from '@/db';
import {
  account,
  company,
  membership,
  passkey,
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
import { MFA_PROVIDERS, type MfaProvider } from '@/lib/sign-in/oauth-providers';
import { availableProviders, configuredProviders } from '@/lib/sign-in/providers';
import { type Actor, loadActor } from '@/server/actor';
import type { ServiceContext } from '@/server/context';

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
    // Every provider that can prove MFA counts as configured again (see `turnOffProviderSignIn`).
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
 * Makes the rest of the current test run as if a provider's sign-in weren't
 * configured on this server (the integration tests configure every provider
 * that can prove MFA), so the MFA rules don't count its accounts' two-factor
 * authentication anywhere: as MFA, as a second step or as something to keep.
 * It changes `availableProviders`, which every service passes to the rules;
 * {@link setupTestContext} turns it back on before the next test.
 *
 * @param provider - The provider; GitHub by default.
 */
export function turnOffProviderSignIn(provider: MfaProvider = 'github'): void {
  const index = availableProviders.indexOf(provider);
  if (index >= 0) {
    availableProviders.splice(index, 1);
  }
}

/** Turns GitHub sign-in off for the rest of the test (see {@link turnOffProviderSignIn}). */
export function turnOffGitHubSignIn(): void {
  turnOffProviderSignIn('github');
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
 * @returns The account row's ID (what Better Auth's unlink takes).
 */
export async function connectProvider(
  db: Database,
  userId: string,
  options: {
    providerId?: 'github' | 'google';
    mfaVerified?: boolean;
    confirmed?: boolean;
    accountName?: string;
  } = {},
): Promise<string> {
  const providerId = options.providerId ?? 'github';
  const created = firstRow(
    await db
      .insert(account)
      .values({
        userId,
        accountId: `${providerId}-${randomUUID()}`,
        providerId,
        mfaVerified: options.mfaVerified ?? true,
        confirmed: options.confirmed ?? true,
        accountName: options.accountName,
      })
      .returning({ id: account.id }),
    'the new account',
  );
  return created.id;
}

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
 */
export async function createStaffSettings(db: Database, name = 'Adiutor Tests'): Promise<void> {
  await db.insert(staffSettings).values({ name });
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
 * @param db - The test database client (from {@link setupTestContext}).
 * @param first - The first request's work in its transaction.
 * @param second - The second request.
 * @returns What `first` returned, and how `second` ended.
 */
export async function atTheSameMoment<F, S>(
  db: Database,
  first: (tx: DatabaseTransaction) => Promise<F>,
  second: () => Promise<S>,
): Promise<{ first: F; second: PromiseSettledResult<S> }> {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  const { promise: held, resolve: holding } = Promise.withResolvers<number>();
  const firstDone = db.transaction(async (tx) => {
    const result = await first(tx);
    const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    holding(firstRow(rows, 'the backend process ID').pid);
    await released;
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
  } finally {
    release();
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
