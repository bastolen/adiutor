/**
 * @file Database helpers for end-to-end tests that need to look at or change
 * the test database in the middle of a test: finding a seeded company, ageing
 * a session's MFA confirmation, deleting the staff settings, storing a
 * sign-in link without sending an email (and using one up), checking whether
 * a browser's session still exists, reading a stored sign-in error, adding
 * someone to a company directly, and storing an invitation or an invite link
 * without sending anything.
 * Each opens its own short connection to the test database. Resetting and
 * seeding the database is `seed.ts`.
 */
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import * as schema from '../../src/db/schema';
import { firstRow } from '../../src/lib/defined';
import {
  emailLinkVerificationIdentifier,
  generateToken,
  hashToken,
} from '../../src/lib/sign-in/tokens';

/** How long the invitations and invite links stored here stay valid. */
const STORED_LINK_LIFETIME_MS = 7 * 24 * 60 * 60_000;

/**
 * Creates a company with no members, for a test that changes it without
 * affecting the seeded ones (e.g. its URL name).
 *
 * @param databaseUrl - Connection string of the test database.
 * @param company - The company.
 * @param company.name - Its name.
 * @param company.slug - Its URL name.
 * @returns Its ID.
 */
export async function createCompany(
  databaseUrl: string,
  company: { name: string; slug: string },
): Promise<string> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const created = firstRow(
      await drizzle(client, { schema })
        .insert(schema.company)
        .values(company)
        .returning({ id: schema.company.id }),
      'the new company',
    );
    return created.id;
  } finally {
    await client.end();
  }
}

/**
 * Looks up a seeded company's ID by its URL name, for tests that open a
 * company page directly.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param slug - The company's URL name, e.g. `adiutor-tests-client`.
 * @returns The company's ID.
 */
export async function findCompanyId(databaseUrl: string, slug: string): Promise<string> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [found] = await drizzle(client, { schema })
      .select({ id: schema.company.id })
      .from(schema.company)
      .where(eq(schema.company.slug, slug));
    if (!found) {
      throw new Error(`No company with URL name ${slug}`);
    }
    return found.id;
  } finally {
    await client.end();
  }
}

/**
 * Adds an existing user to a company with a role, straight in the database,
 * for a test that needs another member (e.g. a second Admin, so the first one
 * may leave) without inviting them.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param companyId - The company.
 * @param email - The user's email address.
 * @param role - Their role there.
 */
export async function addMembership(
  databaseUrl: string,
  companyId: string,
  email: string,
  role: 'admin' | 'client' | 'watcher',
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const db = drizzle(client, { schema });
    const [found] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (!found) {
      throw new Error(`No user ${email}`);
    }
    await db.insert(schema.membership).values({ companyId, userId: found.id, role });
  } finally {
    await client.end();
  }
}

/**
 * Makes the MFA confirmation of every session of a user that many minutes
 * old (`session.mfa_verified_at`), as if they had signed in or confirmed
 * with their second step back then. Changing how they sign in needs one
 * from the last 15 minutes.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param email - The user's email address.
 * @param minutes - How many minutes ago the confirmation should be.
 * @throws {Error} When the user has no sessions, so the test would check nothing.
 */
export async function backdateMfaConfirmation(
  databaseUrl: string,
  email: string,
  minutes: number,
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const db = drizzle(client, { schema });
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
  } finally {
    await client.end();
  }
}

/**
 * Deletes the staff settings row, as if it were lost, so nothing counts as set
 * up while the accounts still exist.
 *
 * @param databaseUrl - Connection string of the test database.
 */
export async function removeStaffSettings(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await drizzle(client, { schema }).delete(schema.staffSettings);
  } finally {
    await client.end();
  }
}

/**
 * Stores a sign-in link for a user the way Better Auth's magic-link plugin
 * does, as if they had asked for one, without sending an email (so tests
 * don't run into the limit on emails per address).
 *
 * @param databaseUrl - Connection string of the test database.
 * @param email - The address the link is for.
 * @returns The path of the page the email would link to, returning to the dashboard.
 */
export async function storeSignInLink(databaseUrl: string, email: string): Promise<string> {
  const token = generateToken();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await drizzle(client, { schema })
      .insert(schema.verification)
      .values({
        identifier: emailLinkVerificationIdentifier(token),
        value: JSON.stringify({ type: 'magic-link', email }),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
  } finally {
    await client.end();
  }
  return `/auth/email-link?${new URLSearchParams({ token, callbackURL: '/dashboard' })}`;
}

/**
 * Stores an open invitation to a company the way the app does (only the
 * token's hash), without sending an email, for tests that open the
 * invitation page. Opening it doesn't use it up.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param invitation - The invitation.
 * @param invitation.companyId - The company to join.
 * @param invitation.email - The invited address (lower-case).
 * @param invitation.role - The company role it gives.
 * @returns The path of the invitation page.
 */
export async function storeInvitation(
  databaseUrl: string,
  {
    companyId,
    email,
    role,
  }: { companyId: string; email: string; role: 'admin' | 'client' | 'watcher' },
): Promise<string> {
  const token = generateToken();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await drizzle(client, { schema })
      .insert(schema.invitation)
      .values({
        companyId,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + STORED_LINK_LIFETIME_MS),
      });
  } finally {
    await client.end();
  }
  return `/invite/${token}`;
}

/**
 * Stores an unused invite link to a company the way the app does (only the
 * token's hash), for tests that open the link's page. Opening it doesn't use
 * it up.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param link - The link.
 * @param link.companyId - The company to join.
 * @param link.role - The company role it gives.
 * @returns The path of the invite link's page.
 */
export async function storeInviteLink(
  databaseUrl: string,
  { companyId, role }: { companyId: string; role: 'admin' | 'client' | 'watcher' },
): Promise<string> {
  const token = generateToken();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await drizzle(client, { schema })
      .insert(schema.inviteLink)
      .values({
        companyId,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + STORED_LINK_LIFETIME_MS),
      });
  } finally {
    await client.end();
  }
  return `/join/${token}`;
}

/**
 * Makes a sign-in link from {@link storeSignInLink} unusable, as if it had
 * expired or been used in another browser.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param link - The link.
 */
export async function useUpSignInLink(databaseUrl: string, link: string): Promise<void> {
  const token = new URL(link, 'https://adiutor.invalid').searchParams.get('token') ?? '';
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await drizzle(client, { schema })
      .delete(schema.verification)
      .where(eq(schema.verification.identifier, emailLinkVerificationIdentifier(token)));
  } finally {
    await client.end();
  }
}

/**
 * Checks whether the session a browser's session cookie names still exists.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param cookieValue - The cookie's value as the browser keeps it:
 *   URL-encoded `<token>.<signature>`.
 * @returns Whether its session is still stored.
 */
export async function sessionOfCookieExists(
  databaseUrl: string,
  cookieValue: string,
): Promise<boolean> {
  const signed = decodeURIComponent(cookieValue);
  const token = signed.slice(0, signed.lastIndexOf('.'));
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const found = await drizzle(client, { schema })
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.token, token));
    return found.length > 0;
  } finally {
    await client.end();
  }
}

/**
 * Looks up a sign-in error by the reference the error page showed, as an
 * admin would.
 *
 * @param databaseUrl - Connection string of the test database.
 * @param reference - The reference, e.g. `7KQ2-M9XD`.
 * @returns Its code and description, or `null` when it wasn't stored.
 */
export async function findSignInError(
  databaseUrl: string,
  reference: string,
): Promise<{ code: string; description: string | null } | null> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [found] = await drizzle(client, { schema })
      .select({ code: schema.signInError.code, description: schema.signInError.description })
      .from(schema.signInError)
      .where(eq(schema.signInError.reference, reference));
    return found ?? null;
  } finally {
    await client.end();
  }
}
