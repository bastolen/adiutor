/**
 * @file First-run setup: naming the staff and creating its first Admin.
 *
 * Setup works only while there's no settings row yet. Once it exists, setup is
 * refused, so `/setup` and `pnpm setup:platform` can't be used to take over
 * an installation. The web form (`/setup`) goes further: it only works on a
 * fresh install, with no accounts at all, so if the settings row were ever
 * lost, nobody can make their existing account staff Admin through it. The
 * command line (run by whoever runs the server) can still promote an existing
 * account, to recover such an installation.
 */
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import type { Database, DatabaseOrTransaction } from '@/db';
import { staffSettings, user } from '@/db/schema';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import { emailSchema, nameSchema, passwordSchema, staffNameSchema } from '@/lib/validation';

import { recordEvent } from './audit';
import { withMfaPromotion } from './auth/mfa-promotion';
import addPasswordCredential from './auth/password-credential';
import { isUniqueViolation, ServiceError } from './errors';

/**
 * The error for setting up an installation that's already set up.
 *
 * @returns The error.
 */
function alreadySetUpError(): ServiceError {
  return new ServiceError('conflict', 'Adiutor is already set up. Sign in instead.');
}

/**
 * Checks whether the staff exists, which means setup is done.
 *
 * @param db - Database client or transaction.
 * @returns Whether setup is done.
 */
export async function isSetUp(db: DatabaseOrTransaction): Promise<boolean> {
  const [found] = await db.select({ id: staffSettings.id }).from(staffSettings).limit(1);
  return Boolean(found);
}

/**
 * Checks whether the web setup form may be used: nothing is set up yet and
 * there are no accounts at all (a fresh install).
 *
 * @param db - Database client or transaction.
 * @returns Whether `/setup` is open.
 */
export async function isWebSetupOpen(db: DatabaseOrTransaction): Promise<boolean> {
  if (await isSetUp(db)) {
    return false;
  }
  const [anyone] = await db.select({ id: user.id }).from(user).limit(1);
  return !anyone;
}

/** Input for {@link setUpPlatform}. */
export interface SetupInput {
  /** The staff name, e.g. "Adiutor". */
  staffName: string;
  /** The first Admin's display name. */
  name: string;
  /** The first Admin's email address. */
  email: string;
  /** Their password; leave out to create an account that signs in by email link. */
  password?: string;
}

/** Options for {@link setUpPlatform}. */
export interface SetupOptions {
  /**
   * May make an existing account the Admin, and runs whenever nothing is set
   * up yet, even with accounts (to recover a lost settings row). Only the
   * command line passes this; without it (the web form), setup only runs on a
   * fresh install (see {@link isWebSetupOpen}) and always creates a new
   * account.
   */
  allowExistingAccount?: boolean;
}

/** What {@link setUpPlatform} did. */
export interface SetupResult {
  /** The Admin's user ID. */
  userId: string;
  /** The Admin's (normalized) email address. */
  email: string;
  /** Whether a new account was created (`false` when the email already had one). */
  createdUser: boolean;
}

/**
 * Names the staff and makes the given person its Admin, in one transaction. A
 * new Admin's email address counts as verified: whoever runs setup owns the
 * installation, and Better Auth would otherwise delete the password at their
 * first email-link sign-in (it removes sign-in methods of unverified accounts
 * when the inbox is proven).
 *
 * With `allowExistingAccount` (the command line), an existing account with
 * that email is used instead: its password isn't changed, a deactivated one is
 * refused, and the promotion is recorded in the audit log (with no acting
 * user). Without it, an existing email makes the insert fail like any other
 * clash, so it can never promote an account.
 *
 * Two simultaneous setups can't both succeed: the database allows only one
 * settings row, and the losing request gets the same "already set up" error.
 *
 * @param db - Database client.
 * @param input - The name shown to users and the Admin's details.
 * @param options - Whether it may use an existing account.
 * @returns What was created.
 * @throws {ServiceError} `conflict` if setup is already done or, without
 *   `allowExistingAccount`, once any account exists (the same message: the
 *   web form doesn't say more); `conflict` for a deactivated account.
 */
export async function setUpPlatform(
  db: Database,
  input: SetupInput,
  options: SetupOptions = {},
): Promise<SetupResult> {
  const allowExisting = options.allowExistingAccount === true;
  const staffName = staffNameSchema.parse(input.staffName);
  const name = nameSchema.parse(input.name);
  const email = emailSchema.parse(input.email);
  /**
   * Checks whether setup may run now.
   *
   * @param conn - Database client or transaction.
   * @returns Whether it may.
   */
  const isOpen = async (conn: DatabaseOrTransaction) =>
    allowExisting ? !(await isSetUp(conn)) : isWebSetupOpen(conn);
  // Refuse before the (deliberately slow) password hash; checked again in the transaction.
  if (!(await isOpen(db))) {
    throw alreadySetUpError();
  }
  const passwordHash =
    input.password === undefined ? null : await hashPassword(passwordSchema.parse(input.password));

  try {
    return await db.transaction(async (tx) => {
      if (!(await isOpen(tx))) {
        throw alreadySetUpError();
      }
      await tx.insert(staffSettings).values({ name: staffName });

      const [existing] = allowExisting
        ? await tx
            .select({
              id: user.id,
              platformRole: user.platformRole,
              deactivatedAt: user.deactivatedAt,
            })
            .from(user)
            .where(eq(user.email, email))
        : [];
      if (existing) {
        if (existing.deactivatedAt) {
          throw new ServiceError(
            'conflict',
            'That account is deactivated, so it could not sign in. Use another address.',
          );
        }
        // Their sessions without MFA that counts for an Admin end (`withMfaPromotion`).
        await withMfaPromotion({ db }, tx, [existing.id], async () => {
          await tx
            .update(user)
            .set({ platformRole: PLATFORM_ADMIN_ROLE })
            .where(eq(user.id, existing.id));
          await recordEvent(
            { db },
            {
              action: existing.platformRole ? 'role_changed' : 'member_added',
              targetUserId: existing.id,
              details: {
                staff: true,
                from: existing.platformRole,
                to: PLATFORM_ADMIN_ROLE,
                role: PLATFORM_ADMIN_ROLE,
                setup: true,
              },
            },
            tx,
          );
        });
        return { userId: existing.id, email, createdUser: false };
      }

      const { id: userId } = firstRow(
        await tx
          .insert(user)
          .values({ name, email, emailVerified: true, platformRole: PLATFORM_ADMIN_ROLE })
          .returning({ id: user.id }),
        'the first staff Admin',
      );
      // The password was chosen just now, so this also lifts the pause from wrong ones typed for
      // the address before.
      if (passwordHash) {
        await addPasswordCredential(tx, { userId, email, passwordHash });
      }
      return { userId, email, createdUser: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw alreadySetUpError();
    }
    throw error;
  }
}
