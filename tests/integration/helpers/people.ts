/**
 * @file Factories for users, companies and members, and loading them as
 * actors.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { company, membership, user } from '@/db/schema';
import type { CompanyRole, PlatformRole } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import type { Locale } from '@/lib/i18n/locales';
import { type Actor, loadActor } from '@/server/actor';

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
