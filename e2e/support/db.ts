/**
 * @file Database helpers for end-to-end tests that need to look at or change
 * the test database in the middle of a test: finding seeded rows, storing what
 * the app would (requests, invitations, links, audit events) without sending
 * anything, ageing or ending what a test needs to see end, and putting a
 * seeded account or setting back to its seeded state. Each opens its own
 * short connection to the test database (`withTestDatabase`). Resetting and
 * seeding the database is `seed.ts`.
 */
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import * as schema from '../../src/db/schema';
import type { AuditAction } from '../../src/lib/audit-actions';
import type { CompanyRole } from '../../src/lib/authz/roles';
import { firstRow } from '../../src/lib/defined';
import { type Locale, LOCALES } from '../../src/lib/i18n/locales';
import { INVITATION_VALID_DAYS } from '../../src/lib/invitation-lifetimes';
import type { RequestPriority, RequestStatus } from '../../src/lib/requests';
import { answerLinkPath } from '../../src/lib/requests';
import { EMAIL_LINK_MINUTES, EMAIL_LINK_PATH } from '../../src/lib/sign-in/email-link';
import { REQUEST_LINK_DAYS } from '../../src/lib/sign-in/request-link';
import {
  emailLinkVerificationIdentifier,
  generateToken,
  hashToken,
} from '../../src/lib/sign-in/tokens';
import { readSettings, writeSettings } from '../../src/server/settings';
import { storeAuthenticator } from '../../tests/auth/authenticator';
import getTestDatabaseUrl from '../../tests/database/database-url';
import storeRequests from '../../tests/database/store-requests';
import {
  COMPANY_SLUG,
  E2E_AUTH_SECRET,
  INVITE_LINK_LIFETIME_MS,
  REQUESTS_CLIENT,
} from './fixtures';
import { inOrder } from './sequence';

/** A Drizzle client on the test database. */
export type TestDatabase = NodePgDatabase<typeof schema>;

/**
 * Runs a function on the test database through its own short connection,
 * which is always closed afterwards. The URL is resolved when it's first
 * needed, so importing this file never reads `.env`.
 *
 * @param run - What to do with the database.
 * @returns What `run` returns.
 */
export async function withTestDatabase<T>(run: (db: TestDatabase) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: getTestDatabaseUrl() });
  await client.connect();
  try {
    return await run(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

/**
 * Creates a company with no members, for a test that changes it without
 * affecting the seeded ones (e.g. its URL name).
 *
 * @param company - The company.
 * @param company.name - Its name.
 * @param company.slug - Its URL name.
 * @returns Its ID.
 */
export async function createCompany(company: { name: string; slug: string }): Promise<string> {
  return withTestDatabase(async (db) => {
    const created = firstRow(
      await db.insert(schema.company).values(company).returning({ id: schema.company.id }),
      'the new company',
    );
    return created.id;
  });
}

/**
 * Looks up a seeded company's ID by its URL name, for tests that open a
 * company page directly.
 *
 * @param slug - The company's URL name, e.g. `adiutor-tests-client`.
 * @returns The company's ID.
 */
export async function findCompanyId(slug: string): Promise<string> {
  return withTestDatabase(async (db) => {
    const [found] = await db
      .select({ id: schema.company.id })
      .from(schema.company)
      .where(eq(schema.company.slug, slug));
    if (!found) {
      throw new Error(`No company with URL name ${slug}`);
    }
    return found.id;
  });
}

/**
 * Looks up a user's ID by their email address on a connection that's already
 * open (a database or a transaction).
 *
 * @param db - The connection.
 * @param email - The user's email address.
 * @returns The user's ID.
 * @throws {Error} When there is no such user.
 */
export async function userIdOf(db: Pick<TestDatabase, 'select'>, email: string): Promise<string> {
  const [found] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (!found) {
    throw new Error(`No user ${email}`);
  }
  return found.id;
}

/**
 * Looks up a request's ID by its number on a connection that's already open
 * (a database or a transaction).
 *
 * @param db - The connection.
 * @param number - The request's number.
 * @returns The request's ID.
 * @throws {Error} When there is no such request.
 */
export async function requestIdOf(
  db: Pick<TestDatabase, 'select'>,
  number: number,
): Promise<string> {
  const [found] = await db
    .select({ id: schema.request.id })
    .from(schema.request)
    .where(eq(schema.request.number, number));
  if (!found) {
    throw new Error(`No request ${number}`);
  }
  return found.id;
}

/**
 * Looks up a seeded user's ID by their email address, for tests that open a
 * user's page directly.
 *
 * @param email - The user's email address.
 * @returns The user's ID.
 */
export async function findUserId(email: string): Promise<string> {
  return withTestDatabase((db) => userIdOf(db, email));
}

/**
 * Stores an audit log entry by one seeded user about another in a company,
 * so the audit log and the user's page show the line that names who acted,
 * whom it was about and the company (each a link).
 *
 * @param event - The entry.
 * @param event.action - What happened.
 * @param event.actorEmail - Who did it.
 * @param event.targetEmail - Whom it was about.
 * @param event.companyId - Which company it was about.
 * @param event.details - What the entry's description reads from.
 * @param event.at - When it happened; now when left out.
 */
export async function storeAuditEvent({
  action,
  actorEmail,
  targetEmail,
  companyId,
  details,
  at = new Date(),
}: {
  action: AuditAction;
  actorEmail: string;
  targetEmail: string;
  companyId: string;
  details: Record<string, unknown>;
  at?: Date;
}): Promise<void> {
  await withTestDatabase(async (db) => {
    const actorUserId = await userIdOf(db, actorEmail);
    const targetUserId = await userIdOf(db, targetEmail);
    await db
      .insert(schema.auditEvent)
      .values({ action, actorUserId, targetUserId, companyId, details, at });
  });
}

/**
 * Forgets what the rate limits counted for a user (their per-user limits,
 * such as wrong current passwords), so a test that runs into one on purpose
 * starts from none, also when it's retried: what an earlier try counted
 * would otherwise add up to the limit, and the retry would fail on "too many
 * attempts" instead of on what it checks.
 *
 * @param email - The user's email address.
 */
export async function forgetLimitsOf(email: string): Promise<void> {
  const userId = await findUserId(email);
  await withTestDatabase(async (db) => {
    await db
      .delete(schema.rateLimitBucket)
      .where(like(schema.rateLimitBucket.key, `%:user:${userId}`));
  });
}

/**
 * Resumes a background job if a test left it paused, so a retried test starts
 * from a running job.
 *
 * @param name - The job's name.
 */
export async function resumeJob(name: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db
      .update(schema.jobState)
      .set({ pausedAt: null, pausedBy: null })
      .where(eq(schema.jobState.name, name));
  });
}

/**
 * Makes the last tick look two hours old, so the Jobs page and the dashboard
 * warn that background jobs aren't running, until the next tick.
 */
export async function makeTickLate(): Promise<void> {
  await withTestDatabase(async (db) => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    await db.transaction((tx) => writeSettings(tx, { 'jobs.last_tick': twoHoursAgo }));
  });
}

/**
 * Discards the failed queued jobs of a kind that an earlier attempt of a test
 * left behind, so a retried test starts without them.
 *
 * @param kind - The kind's name.
 */
export async function discardFailedQueuedJobs(kind: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db
      .update(schema.queuedJob)
      .set({ status: 'discarded', finishedAt: new Date() })
      .where(and(eq(schema.queuedJob.kind, kind), eq(schema.queuedJob.status, 'failed')));
  });
}

/**
 * Stores a `staff-admin-added` queued job that was given up after its last
 * attempt, for the Jobs page's Retry and Discard. It tells a Manager about a
 * new staff Admin, so when it's retried the job is skipped (the recipient
 * isn't a staff Admin) and never fails a later tick or sends an email.
 *
 * @param managerEmail - A Manager's email address.
 * @returns The job's ID.
 */
export async function storeFailedQueuedJob(managerEmail: string): Promise<string> {
  const managerId = await findUserId(managerEmail);
  return withTestDatabase(async (db) => {
    const stored = await db
      .insert(schema.queuedJob)
      .values({
        kind: 'staff-admin-added',
        payload: { recipientId: managerId, newAdminId: managerId, how: 'role', byUserId: null },
        status: 'failed',
        attempts: 5,
        finishedAt: new Date(),
      })
      .returning({ id: schema.queuedJob.id });
    return firstRow(stored, 'the failed queued job').id;
  });
}

/**
 * Adds an existing user to a company with a role, straight in the database,
 * for a test that needs another member (e.g. a second Admin, so the first one
 * may leave) without inviting them.
 *
 * @param companyId - The company.
 * @param email - The user's email address.
 * @param role - Their role there.
 */
export async function addMembership(
  companyId: string,
  email: string,
  role: CompanyRole,
): Promise<void> {
  const userId = await findUserId(email);
  await withTestDatabase(async (db) => {
    await db.insert(schema.membership).values({ companyId, userId, role });
  });
}

/**
 * Sets a member's role in a company straight in the database, for a test
 * that changes a role in the app to put it back whatever happens.
 *
 * @param companySlug - The URL name of the company.
 * @param email - The member's email address.
 * @param role - The role they get there.
 */
export async function setMembershipRole(
  companySlug: string,
  email: string,
  role: CompanyRole,
): Promise<void> {
  const [companyId, userId] = await Promise.all([findCompanyId(companySlug), findUserId(email)]);
  await withTestDatabase(async (db) => {
    await db
      .update(schema.membership)
      .set({ role })
      .where(and(eq(schema.membership.companyId, companyId), eq(schema.membership.userId, userId)));
  });
}

/**
 * Reads the time zone saved with an account (`user.time_zone`).
 *
 * @param email - The account's address.
 * @returns The zone, or `null` when none is saved.
 */
export async function savedTimeZoneOf(email: string): Promise<string | null> {
  return withTestDatabase(async (db) => {
    const found = firstRow(
      await db
        .select({ timeZone: schema.user.timeZone })
        .from(schema.user)
        .where(eq(schema.user.email, email)),
      'the account',
    );
    return found.timeZone;
  });
}

/**
 * Makes the MFA confirmation of every session of a user that many minutes
 * old (`session.mfa_verified_at`), as if they had signed in or confirmed
 * with their second step back then. Changing how they sign in needs one
 * from the last 15 minutes.
 *
 * @param email - The user's email address.
 * @param minutes - How many minutes ago the confirmation should be.
 * @throws {Error} When the user has no sessions, so the test would check nothing.
 */
export async function backdateMfaConfirmation(email: string, minutes: number): Promise<void> {
  await withTestDatabase(async (db) => {
    const updated = await db
      .update(schema.session)
      .set({ mfaVerifiedAt: new Date(Date.now() - minutes * 60_000) })
      .where(
        inArray(
          schema.session.userId,
          db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)),
        ),
      )
      .returning({ id: schema.session.id });
    if (updated.length === 0) {
      throw new Error(`${email} has no sessions to backdate.`);
    }
  });
}

/**
 * Makes a staff member's sign-in as a user end in a few seconds
 * (`impersonation.expires_at`), instead of after `IMPERSONATION_MINUTES`, so
 * a test can see it end by itself. Pages rendered before still count down
 * from the old end: load the page again.
 *
 * @param staffEmail - The staff member's email address.
 * @param seconds - In how many seconds it should end.
 * @throws {Error} When the staff member isn't signed in as anyone, so the test would check nothing.
 */
export async function endSignInAsSoon(staffEmail: string, seconds: number): Promise<void> {
  await withTestDatabase(async (db) => {
    const updated = await db
      .update(schema.impersonation)
      .set({ expiresAt: sql`now() + make_interval(secs => ${seconds})` })
      .where(
        inArray(
          schema.impersonation.staffUserId,
          db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.email, staffEmail)),
        ),
      )
      .returning({ id: schema.impersonation.id });
    if (updated.length === 0) {
      throw new Error(`${staffEmail} isn't signed in as anyone.`);
    }
  });
}

/**
 * Deletes the staff's settings and the mark that setup was done, as if they
 * were lost, so nothing counts as set up while the accounts still exist.
 */
export async function removeStaffSettings(): Promise<void> {
  await withTestDatabase(async (db) => {
    await db
      .delete(schema.setting)
      .where(or(eq(schema.setting.key, 'setup.completed_at'), like(schema.setting.key, 'staff.%')));
  });
}

/**
 * Sets Adiutor's default language and the languages it offers directly, e.g.
 * to put them back after a test changed them in Settings.
 *
 * @param locale - The default language.
 * @param offered - The languages to offer; every language by default.
 */
export async function setDefaultLocale(
  locale: Locale,
  offered: Locale[] = [...LOCALES],
): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.transaction((tx) =>
      writeSettings(tx, { 'staff.default_locale': locale, 'staff.offered_locales': offered }),
    );
  });
}

/**
 * Sets Adiutor's default time zone directly, e.g. to put it back after a test
 * changed it in Settings.
 *
 * @param timeZone - The zone, e.g. `UTC`.
 */
export async function setDefaultTimeZone(timeZone: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.transaction((tx) => writeSettings(tx, { 'staff.default_time_zone': timeZone }));
  });
}

/**
 * Reads Adiutor's default time zone.
 *
 * @returns The zone in its setting (UTC while it has none).
 */
export async function defaultTimeZoneNow(): Promise<string> {
  return withTestDatabase(async (db) => {
    const settings = await readSettings(db, ['staff.default_time_zone']);
    return settings['staff.default_time_zone'];
  });
}

/**
 * Sets the prefix request numbers are shown with directly, for tests about
 * the numbers (the field in Settings is tested in `settings.spec.ts`), and
 * to put it back afterwards.
 *
 * @param prefix - The prefix, e.g. "AD".
 */
export async function setRequestPrefix(prefix: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.transaction((tx) => writeSettings(tx, { 'requests.prefix': prefix }));
  });
}

/**
 * Brings back the dashboard's MFA recommendation for a user, as if they had
 * never dismissed it, so a test that dismisses it can run again.
 *
 * @param email - The user's address.
 */
export async function clearMfaRecommendationDismissal(email: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db
      .update(schema.user)
      .set({ mfaRecommendationDismissedAt: null })
      .where(eq(schema.user.email, email));
  });
}

/**
 * Turns two-step verification off for a seeded account, as before a test
 * turned it on: no email codes or authenticator (`two_factor` rows), no
 * device it trusts, and none of its per-user limits counted. A test that
 * turns it on calls this first, so a retry starts where the first attempt
 * did.
 *
 * @param email - The user's address.
 */
export async function resetMfaOf(email: string): Promise<void> {
  const userId = await findUserId(email);
  await withTestDatabase(async (db) => {
    await db.update(schema.user).set({ twoFactorEnabled: false }).where(eq(schema.user.id, userId));
    await db.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, userId));
    await db
      .delete(schema.verification)
      .where(
        and(
          like(schema.verification.identifier, 'trust-device-%'),
          eq(schema.verification.value, userId),
        ),
      );
  });
  await forgetLimitsOf(email);
}

/**
 * Gives a seeded account its authenticator app back, as the seed set it up
 * (two-step verification on, the secret, no backup codes left), whatever a
 * test did to it, so a test that resets or replaces it can run again.
 *
 * @param person - The account.
 * @param person.email - Its address.
 * @param person.totpSecret - Its raw authenticator secret.
 */
export async function restoreAuthenticatorOf(person: {
  email: string;
  totpSecret: string;
}): Promise<void> {
  await resetMfaOf(person.email);
  const userId = await findUserId(person.email);
  await withTestDatabase((db) =>
    storeAuthenticator(db, userId, person.totpSecret, E2E_AUTH_SECRET),
  );
}

/**
 * Removes the passkeys of an account, so a test that adds one starts from an
 * account without any, also when it's retried or repeated.
 *
 * @param email - The account's address.
 */
export async function removePasskeysOf(email: string): Promise<void> {
  const userId = await findUserId(email);
  await withTestDatabase(async (db) => {
    await db.delete(schema.passkey).where(eq(schema.passkey.userId, userId));
  });
}

/**
 * Marks an account's email address as not verified, as the seed leaves
 * `UNVERIFIED_USER`, so a test that verifies it can run again.
 *
 * @param email - The account's address.
 */
export async function markEmailUnverified(email: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.update(schema.user).set({ emailVerified: false }).where(eq(schema.user.email, email));
  });
}

/**
 * Sets which picture an account shows (`user.avatar_source`): `null` for none
 * chosen yet, which shows the picture of the account connected first. The
 * seed gives the Support member initials, so no page fetches their Google
 * picture; the tests about pictures choose `null` and put initials back.
 *
 * @param email - The account's address.
 * @param source - What they chose.
 */
export async function choosePictureOf(
  email: string,
  source: 'initials' | 'github' | 'google' | null,
): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.update(schema.user).set({ avatarSource: source }).where(eq(schema.user.email, email));
  });
}

/**
 * Lets staff sign in as an account again (the setting is on unless the user
 * turns it off), for a test that turns it off.
 *
 * @param email - The account's address.
 */
export async function allowStaffSignInOf(email: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db
      .update(schema.user)
      .set({ allowStaffSignIn: true })
      .where(eq(schema.user.email, email));
  });
}

/**
 * Sets the name Adiutor shows users directly, e.g. to put it back after a
 * test changed it in Settings.
 *
 * @param name - The name.
 */
export async function setStaffName(name: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.transaction((tx) => writeSettings(tx, { 'staff.name': name }));
  });
}

/**
 * Reactivates an account straight in the database: the other way round of
 * {@link deactivateAccount}, to put a deactivated account back.
 *
 * @param email - The account's address.
 */
export async function reactivateAccount(email: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.update(schema.user).set({ deactivatedAt: null }).where(eq(schema.user.email, email));
  });
}

/**
 * Deactivates an account straight in the database, keeping its roles, as a
 * deactivation does: for a test that reactivates it, so a retry starts where
 * the first attempt did. The account must have no sessions (deactivating
 * ends them; this doesn't).
 *
 * @param email - The account's address.
 */
export async function deactivateAccount(email: string): Promise<void> {
  const userId = await findUserId(email);
  await withTestDatabase(async (db) => {
    await db
      .update(schema.user)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.user.id, userId));
  });
}

/**
 * Stores a sign-in link for a user the way Better Auth's magic-link plugin
 * does, as if they had asked for one, without sending an email (so tests
 * don't run into the limit on emails per address).
 *
 * @param email - The address the link is for.
 * @returns The path of the page the email would link to, returning to the dashboard.
 */
export async function storeSignInLink(email: string): Promise<string> {
  const token = generateToken();
  await withTestDatabase(async (db) => {
    await db.insert(schema.verification).values({
      identifier: emailLinkVerificationIdentifier(token),
      value: JSON.stringify({ type: 'magic-link', email }),
      expiresAt: new Date(Date.now() + EMAIL_LINK_MINUTES * 60_000),
    });
  });
  return `${EMAIL_LINK_PATH}?${new URLSearchParams({ token, callbackURL: '/dashboard' })}`;
}

/**
 * Stores an email's answer link the way the email's job does (only the
 * token's hash), for a request that waits for approval: it gives the request
 * the status entry that proposed the solution and makes the link for a
 * member of its company. For tests that open the link's page.
 *
 * @param link - The link.
 * @param link.requestNumber - A request stored with the status `proposed`.
 * @param link.email - The member the link answers for.
 * @returns The path of the link's page (`/answer/<token>`).
 */
export async function storeAnswerLink({
  requestNumber,
  email,
}: {
  requestNumber: number;
  email: string;
}): Promise<string> {
  const token = generateToken();
  await withTestDatabase(async (db) => {
    const stored = { id: await requestIdOf(db, requestNumber) };
    const member = { id: await userIdOf(db, email) };
    const proposal = firstRow(
      await db
        .insert(schema.requestEntry)
        .values({
          requestId: stored.id,
          kind: 'status',
          authorSide: 'staff',
          fromValue: 'in_progress',
          toValue: 'proposed',
        })
        .returning({ id: schema.requestEntry.id }),
      'the proposal',
    );
    await db.insert(schema.requestAnswerLink).values({
      requestId: stored.id,
      userId: member.id,
      proposalEntryId: proposal.id,
      tokenHash: hashToken(token),
      // Answer links last as long as the links of emails about a request.
      expiresAt: new Date(Date.now() + REQUEST_LINK_DAYS * 86_400_000),
    });
  });
  return answerLinkPath(token);
}

/**
 * Stores the link in an email about a request the way the job that sends
 * the email does (only the token's hash, for 14 days), without sending an
 * email, for tests that open it (decision 0036).
 *
 * @param email - The address of the person it signs in.
 * @param number - The number of the request it opens.
 * @param options - Options.
 * @param options.ended - Store it as ended already, as signing out everywhere leaves it.
 * @returns The link's token (`requestLinkPath` builds the link, `requestLinkPagePath` its
 *   confirmation page).
 */
export async function storeRequestLink(
  email: string,
  number: number,
  { ended = false } = {},
): Promise<string> {
  const token = generateToken();
  await withTestDatabase(async (db) => {
    const person = { id: await userIdOf(db, email) };
    const stored = { id: await requestIdOf(db, number) };
    await db.insert(schema.requestSignInLink).values({
      userId: person.id,
      requestId: stored.id,
      tokenHash: hashToken(token),
      expiresAt: ended ? sql`now()` : sql`now() + make_interval(days => ${REQUEST_LINK_DAYS})`,
    });
  });
  return token;
}

/**
 * Stores an open invitation to a company the way the app does (only the
 * token's hash), without sending an email, for tests that open the
 * invitation page. Opening it doesn't use it up. Like inviting an address
 * again in the app, it replaces that address's open invitation, so a test
 * that runs again (a retry) still gets one.
 *
 * @param invitation - The invitation.
 * @param invitation.companyId - The company to join.
 * @param invitation.email - The invited address (lower-case).
 * @param invitation.role - The company role it gives.
 * @returns The path of the invitation page.
 */
export async function storeInvitation({
  companyId,
  email,
  role,
}: {
  companyId: string;
  email: string;
  role: CompanyRole;
}): Promise<string> {
  const token = generateToken();
  await withTestDatabase(async (db) => {
    await db
      .update(schema.invitation)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.invitation.companyId, companyId),
          eq(schema.invitation.email, email),
          isNull(schema.invitation.acceptedAt),
          isNull(schema.invitation.revokedAt),
        ),
      );
    await db.insert(schema.invitation).values({
      companyId,
      email,
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_VALID_DAYS * 24 * 60 * 60_000),
    });
  });
  return `/invite/${token}`;
}

/**
 * Stores an unused invite link to a company the way the app does (only the
 * token's hash), for tests that open the link's page. Opening it doesn't use
 * it up.
 *
 * @param link - The link.
 * @param link.companyId - The company to join.
 * @param link.role - The company role it gives.
 * @returns The path of the invite link's page.
 */
export async function storeInviteLink({
  companyId,
  role,
}: {
  companyId: string;
  role: CompanyRole;
}): Promise<string> {
  const token = generateToken();
  await withTestDatabase(async (db) => {
    await db.insert(schema.inviteLink).values({
      companyId,
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_LINK_LIFETIME_MS),
    });
  });
  return `/join/${token}`;
}

/**
 * Makes a sign-in link from {@link storeSignInLink} unusable, as if it had
 * expired or been used in another browser.
 *
 * @param link - The link.
 */
export async function useUpSignInLink(link: string): Promise<void> {
  const token = new URL(link, 'https://adiutor.invalid').searchParams.get('token') ?? '';
  await withTestDatabase(async (db) => {
    await db
      .delete(schema.verification)
      .where(eq(schema.verification.identifier, emailLinkVerificationIdentifier(token)));
  });
}

/**
 * Checks whether the session a browser's session cookie names still exists.
 *
 * @param cookieValue - The cookie's value as the browser keeps it:
 *   URL-encoded `<token>.<signature>`.
 * @returns Whether its session is still stored.
 */
export async function sessionOfCookieExists(cookieValue: string): Promise<boolean> {
  const signed = decodeURIComponent(cookieValue);
  const token = signed.slice(0, signed.lastIndexOf('.'));
  return withTestDatabase(async (db) => {
    const found = await db
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.token, token));
    return found.length > 0;
  });
}

/**
 * Looks up a sign-in error by the reference the error page showed, as an
 * admin would.
 *
 * @param reference - The reference, e.g. `7KQ2-M9XD`.
 * @returns Its code and description, or `null` when it wasn't stored.
 */
export async function findSignInError(
  reference: string,
): Promise<{ code: string; description: string | null } | null> {
  return withTestDatabase(async (db) => {
    const [found] = await db
      .select({ code: schema.signInError.code, description: schema.signInError.description })
      .from(schema.signInError)
      .where(eq(schema.signInError.reference, reference));
    return found ?? null;
  });
}

/**
 * Stores a request raised by someone at a company, without going through the
 * app: a request of the test's own, since no test changes the seeded ones.
 * It gets the next number, so requests raised afterwards continue from it.
 *
 * @param request - The request.
 * @param request.companySlug - The URL name of the company it's in.
 * @param request.raisedBy - The email address of the member who raised it.
 * @param request.title - Its title.
 * @param request.description - What's asked; a short text when left out.
 * @param request.type - Its type; a bug when left out.
 * @param request.priority - Its priority; normal when left out.
 * @param request.status - Its status; open when left out.
 * @param request.at - When it was raised; now when left out. With earlier replies, it was
 *   raised a minute before the first of them instead, and the last is a minute before `at`.
 * @param request.earlierReplies - How many replies its raiser wrote before `at`, a minute apart,
 *   for a conversation long enough to scroll; none when left out.
 * @returns The request's number.
 */
export async function storeRequest({
  companySlug,
  raisedBy,
  title,
  description = 'A request stored for a test.',
  type = 'bug',
  priority = 'normal',
  status = 'open',
  at = new Date(),
  earlierReplies = 0,
}: {
  companySlug: string;
  raisedBy: string;
  title: string;
  description?: string;
  type?: string;
  priority?: RequestPriority;
  status?: RequestStatus;
  at?: Date;
  earlierReplies?: number;
}): Promise<number> {
  return withTestDatabase(async (db) => {
    const company = firstRow(
      await db
        .select({ id: schema.company.id })
        .from(schema.company)
        .where(eq(schema.company.slug, companySlug)),
      'the company',
    );
    const author = { id: await userIdOf(db, raisedBy) };
    const counter = await readSettings(db, ['requests.last_number']);
    const numbers = await storeRequests(
      db,
      [
        {
          companyId: company.id,
          title,
          description,
          type,
          priority,
          status,
          raisedBy: { id: author.id, side: 'company' },
          // Raised at `at`; with earlier replies, a minute before the first, so anything added now
          // comes last.
          at: earlierReplies > 0 ? new Date(at.getTime() - (earlierReplies + 1) * 60_000) : at,
          entries: Array.from({ length: earlierReplies }, (_, index) => ({
            by: { id: author.id, side: 'company' as const },
            at: new Date(at.getTime() - (earlierReplies - index) * 60_000),
            reply: `Earlier reply ${index + 1}, to make the conversation long.`,
          })),
        },
      ],
      counter['requests.last_number'] + 1,
    );
    return firstRow(numbers, 'the new request number');
  });
}

/**
 * Stores a request of the test's own in the seeded company, raised by
 * {@link REQUESTS_CLIENT} unless someone else is named: {@link storeRequest}
 * with that company and member as its defaults.
 *
 * @param request - The request, see {@link storeRequest}.
 * @returns The request's number.
 */
export async function storeOwnRequest(
  request: Omit<Parameters<typeof storeRequest>[0], 'companySlug' | 'raisedBy'> &
    Partial<Pick<Parameters<typeof storeRequest>[0], 'companySlug' | 'raisedBy'>>,
): Promise<number> {
  return storeRequest({ companySlug: COMPANY_SLUG, raisedBy: REQUESTS_CLIENT.email, ...request });
}

/**
 * Changes a test's own request's status without going through the app, as a
 * colleague would have meanwhile: for the test of a board that's out of date.
 * Nothing else about the request changes, and its history doesn't say so.
 *
 * @param number - The request's number.
 * @param status - Its new status.
 */
export async function setStoredRequestStatus(number: number, status: RequestStatus): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.update(schema.request).set({ status }).where(eq(schema.request.number, number));
  });
}

/** One entry {@link storeEntries} adds to a request's history. */
type StoredEntry = {
  /** The email address of who wrote or changed it. */
  by: string;
  /** The side they act as. */
  side: 'company' | 'staff';
} & (
  | {
      /** A reply, or an internal note (staff). */
      kind: 'comment' | 'note';
      /** Its text. */
      text: string;
    }
  | {
      /** A change of the status. */
      kind: 'status';
      /** What it was. */
      from: RequestStatus;
      /** What it became. */
      to: RequestStatus;
    }
);

/**
 * Adds entries to a test's own request without going through the app:
 * replies, internal notes and status changes, in the order given (entries
 * are read in ID order). The request itself isn't changed, so its status
 * stays as it was stored.
 *
 * @param number - The request's number.
 * @param entries - The entries, oldest first.
 */
export async function storeEntries(number: number, entries: readonly StoredEntry[]): Promise<void> {
  await withTestDatabase(async (db) => {
    const found = { id: await requestIdOf(db, number) };
    // One after another: IDs are time-ordered, and a request's entries are read in ID order.
    await inOrder(entries, async (entry) => {
      const author = { id: await userIdOf(db, entry.by) };
      await db.insert(schema.requestEntry).values({
        requestId: found.id,
        authorId: author.id,
        authorSide: entry.side,
        kind: entry.kind,
        ...(entry.kind === 'status'
          ? { fromValue: entry.from, toValue: entry.to }
          : { body: entry.text }),
      });
    });
  });
}

/**
 * Finds an entry of a test's own request by its text, for a test that links
 * to it the way an email does (`?entry=<ID>#entry-<ID>`).
 *
 * @param number - The request's number.
 * @param text - The entry's whole text.
 * @returns The entry's ID.
 */
export async function findEntryId(number: number, text: string): Promise<string> {
  return withTestDatabase(
    async (db) =>
      firstRow(
        await db
          .select({ id: schema.requestEntry.id })
          .from(schema.requestEntry)
          .innerJoin(schema.request, eq(schema.requestEntry.requestId, schema.request.id))
          .where(and(eq(schema.request.number, number), eq(schema.requestEntry.body, text))),
        'the entry',
      ).id,
  );
}

/**
 * Forgets how a user reads a request's activity, so a test starts from
 * everything, oldest first, also when it runs again.
 *
 * @param email - The user's email address.
 */
export async function resetActivityView(email: string): Promise<void> {
  await withTestDatabase(async (db) => {
    await db
      .update(schema.user)
      .set({ activityOrder: null, activityGroups: null })
      .where(eq(schema.user.email, email));
  });
}

/**
 * Removes the webhooks a spec added, by name, so later specs' request changes
 * queue no deliveries to a receiver that's gone.
 *
 * @param names - The webhooks' names.
 */
export async function removeWebhooks(names: readonly string[]): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.delete(schema.webhook).where(inArray(schema.webhook.name, [...names]));
  });
}
