/**
 * @file Database helpers for end-to-end tests that need to look at or change
 * the test database in the middle of a test: finding a seeded company or user, ageing
 * a session's MFA confirmation, deleting the staff settings, storing a
 * sign-in link without sending an email (and using one up), checking whether
 * a browser's session still exists, reading a stored sign-in error, adding
 * someone to a company directly, and storing an invitation or an invite link
 * without sending anything.
 * Each opens its own short connection to the test database (`withTestDatabase`).
 * Resetting and seeding the database is `seed.ts`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import * as schema from '../../src/db/schema';
import type { CompanyRole } from '../../src/lib/authz/roles';
import { firstRow } from '../../src/lib/defined';
import type { Locale } from '../../src/lib/i18n/locales';
import { INVITATION_VALID_DAYS } from '../../src/lib/invitation-lifetimes';
import { EMAIL_LINK_MINUTES, EMAIL_LINK_PATH } from '../../src/lib/sign-in/email-link';
import {
  emailLinkVerificationIdentifier,
  generateToken,
  hashToken,
} from '../../src/lib/sign-in/tokens';
import getTestDatabaseUrl from '../../tests/database/database-url';

/** How long the invite links stored here stay valid (any of the lifetimes a link can have). */
const INVITE_LINK_LIFETIME_MS = 7 * 24 * 60 * 60_000;

/** A Drizzle client on the test database. */
type TestDatabase = NodePgDatabase<typeof schema>;

/**
 * Runs a function on the test database through its own short connection,
 * which is always closed afterwards. The URL is resolved when it's first
 * needed, so importing this file never reads `.env`.
 *
 * @param run - What to do with the database.
 * @returns What `run` returns.
 */
async function withTestDatabase<T>(run: (db: TestDatabase) => Promise<T>): Promise<T> {
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
 * Looks up a seeded user's ID by their email address, for tests that open a
 * user's page directly.
 *
 * @param email - The user's email address.
 * @returns The user's ID.
 */
export async function findUserId(email: string): Promise<string> {
  return withTestDatabase(async (db) => {
    const [found] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (!found) {
      throw new Error(`No user ${email}`);
    }
    return found.id;
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
 * Deletes the staff settings row, as if it were lost, so nothing counts as set
 * up while the accounts still exist.
 */
export async function removeStaffSettings(): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.delete(schema.staffSettings);
  });
}

/**
 * Sets Adiutor's default language directly, e.g. to put it back after a test
 * changed it on the staff page.
 *
 * @param locale - The language.
 */
export async function setDefaultLocale(locale: Locale): Promise<void> {
  await withTestDatabase(async (db) => {
    await db.update(schema.staffSettings).set({ defaultLocale: locale });
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
