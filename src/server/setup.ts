/**
 * @file First-run setup: naming the staff and creating its first Admin.
 *
 * Setup works only while Adiutor isn't set up yet: the `setup.completed_at`
 * setting, which setup writes, isn't there. Once it is, setup is refused, so
 * `/setup` and `pnpm setup:platform` can't be used to take over an
 * installation. The web form (`/setup`) goes further: it only works on a
 * fresh install, with no accounts at all, so if that setting were ever lost,
 * nobody can make their existing account staff Admin through it. The
 * command line (run by whoever runs the server) can still promote an existing
 * account, to recover such an installation.
 */
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { user } from '@/db/schema';
import { PLATFORM_ADMIN_ROLE } from '@/lib/authz/roles';
import { firstRow } from '@/lib/defined';
import { DEFAULT_LOCALE, type Locale, LOCALES } from '@/lib/i18n/locales';
import { DEFAULT_TIME_ZONE, isTimeZone } from '@/lib/i18n/time-zones';
import {
  emailSchema,
  localeSchema,
  nameSchema,
  passwordSchema,
  staffNameSchema,
} from '@/lib/validation';

import { recordEvent } from './audit';
import { withMfaPromotion } from './auth/mfa-promotion';
import addPasswordCredential from './auth/password-credential';
import type { ServiceContext } from './context';
import { isUniqueViolation, ServiceError } from './errors';
import { nameBuiltInRequestTypes } from './requests';
import { addSetting, readSettings, writeSettings } from './settings';

/**
 * The error for setting up an installation that's already set up.
 *
 * @returns The error.
 */
function alreadySetUpError(): ServiceError {
  return new ServiceError('conflict', 'errors.setup.alreadySetUp');
}

/**
 * Checks whether setup is done: it wrote when (`setup.completed_at`). Saving
 * any other setting never counts.
 *
 * @param db - Database client or transaction.
 * @returns Whether setup is done.
 */
export async function isSetUp(db: DatabaseOrTransaction): Promise<boolean> {
  const settings = await readSettings(db, ['setup.completed_at']);
  return settings['setup.completed_at'] !== null;
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
  /**
   * Adiutor's default language, for everyone who hasn't chosen one, as the
   * form sent it; English (US) when left out.
   */
  defaultLocale?: string;
  /**
   * A new Admin's own language: the one they set up in, so choosing another
   * default doesn't switch their screens. When it's the default they chose,
   * or left out, they start on Default (no saved language) and follow it. An
   * existing account (the command line) keeps its own.
   */
  adminLocale?: Locale;
  /**
   * The zone of the browser setup runs in: Adiutor's default zone, and a new
   * Admin's own. Left out, empty or not a zone Adiutor accepts (the command
   * line, or before the form hydrated), Adiutor starts in UTC and the Admin's
   * browser saves theirs on their first visit. An existing account keeps its
   * own.
   */
  timeZone?: string;
}

/** Options for {@link setUpPlatform}. */
interface SetupOptions {
  /**
   * May make an existing account the Admin, and runs whenever nothing is set
   * up yet, even with accounts (to recover a lost `setup.completed_at`). Only the
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
 * Names the staff, sets Adiutor's default language and time zone and makes
 * the given person its Admin, in one transaction. A
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
 * A new Admin's account is recorded in the audit log (`account_created`, by
 * and about them, with its address and `setup: true`).
 *
 * Two simultaneous setups can't both succeed: each first adds the
 * `setup.completed_at` setting, whose key the database allows once, so the
 * second waits for the first and gets the same "already set up" error.
 *
 * @param ctx - Service context.
 * @param input - The name shown to users, Adiutor's default language and zone, and the Admin's
 *   details.
 * @param options - Whether it may use an existing account.
 * @returns What was created.
 * @throws {ServiceError} `conflict` if setup is already done or, without
 *   `allowExistingAccount`, once any account exists (the same message: the
 *   web form doesn't say more); `conflict` for a deactivated account.
 */
export async function setUpPlatform(
  ctx: Pick<ServiceContext, 'db'>,
  input: SetupInput,
  options: SetupOptions = {},
): Promise<SetupResult> {
  const allowExisting = options.allowExistingAccount === true;
  const staffName = staffNameSchema.parse(input.staffName);
  const name = nameSchema.parse(input.name);
  const email = emailSchema.parse(input.email);
  const defaultLocale =
    input.defaultLocale === undefined ? DEFAULT_LOCALE : localeSchema.parse(input.defaultLocale);
  const timeZone = isTimeZone(input.timeZone) ? input.timeZone : null;
  /**
   * Checks whether setup may run now.
   *
   * @param conn - Database client or transaction.
   * @returns Whether it may.
   */
  const isOpen = async (conn: DatabaseOrTransaction) =>
    allowExisting ? !(await isSetUp(conn)) : isWebSetupOpen(conn);
  // Refuse before the (deliberately slow) password hash; checked again in the transaction.
  if (!(await isOpen(ctx.db))) {
    throw alreadySetUpError();
  }
  const passwordHash =
    input.password === undefined ? null : await hashPassword(passwordSchema.parse(input.password));

  try {
    return await ctx.db.transaction(async (tx) => {
      if (!(await isOpen(tx))) {
        throw alreadySetUpError();
      }
      // First, so a second setup at the same moment waits here and then fails on the key.
      await addSetting(tx, 'setup.completed_at', new Date());
      // Every language there is now, so one added later starts off (decision 0029).
      await writeSettings(tx, {
        'staff.name': staffName,
        'staff.default_locale': defaultLocale,
        'staff.offered_locales': [...LOCALES],
        'staff.default_time_zone': timeZone ?? DEFAULT_TIME_ZONE,
      });
      // The built-in request types were named before there was a language: name them in this one.
      await nameBuiltInRequestTypes(tx, defaultLocale);

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
          throw new ServiceError('conflict', 'errors.setup.accountDeactivated');
        }
        // Their sessions without MFA that counts for an Admin end (`withMfaPromotion`).
        await withMfaPromotion(ctx, tx, [existing.id], async () => {
          await tx
            .update(user)
            .set({ platformRole: PLATFORM_ADMIN_ROLE })
            .where(eq(user.id, existing.id));
          await recordEvent(
            ctx,
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
          .values({
            name,
            email,
            emailVerified: true,
            platformRole: PLATFORM_ADMIN_ROLE,
            // Default when they set up in the default language; otherwise they keep theirs.
            locale:
              input.adminLocale && input.adminLocale !== defaultLocale ? input.adminLocale : null,
            timeZone,
          })
          .returning({ id: user.id }),
        'the first staff Admin',
      );
      await recordEvent(
        ctx,
        {
          action: 'account_created',
          actorUserId: userId,
          targetUserId: userId,
          details: { email, setup: true },
        },
        tx,
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
