/**
 * @file Registering user accounts quickly, like adding a company: staff enter
 * an email address, the account is created right away (without companies or a
 * staff role), and the person gets a welcome email with a link to choose a
 * password.
 */
import { eq, sql } from 'drizzle-orm';

import { user, verification } from '@/db/schema';
import { accountCreatedEmail } from '@/emails/account-created';
import { firstRow } from '@/lib/defined';
import displayName from '@/lib/display-name';
import type { Locale } from '@/lib/i18n/locales';
import { generateToken, hashVerificationIdentifier } from '@/lib/sign-in/tokens';
import { emailSchema } from '@/lib/validation';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import { loadEmailBrand } from '../branding';
import type { ServiceContext } from '../context';
import { isUniqueViolation } from '../errors';
import assertLanguageOffered from '../offered-language';
import { assertInviteSenderLimit } from '../rate-limit';
import recipientLocale from '../recipient-locale';
import getStaffName from './staff-name';

/** How many days the "choose your password" link stays valid. */
const WELCOME_LINK_VALID_DAYS = 7;

/** What {@link registerUser} did. */
export type RegisterResult =
  | {
      /** A new account was created and the welcome email sent. */
      status: 'created';
      /** The new user's ID. */
      userId: string;
    }
  | {
      /** The email address already had an account; nothing changed. */
      status: 'exists';
      /** That account's ID. */
      userId: string;
    };

/**
 * Creates an account for an email address and emails its owner a link to
 * choose a password. The link uses Better Auth's password reset token
 * (`reset-password:<token>` in the verification table), so the existing
 * reset page sets the first password, and Better Auth creates the password
 * sign-in for the account then. Signing in with an email link works right
 * away too. Staff may see whether the address already had an account.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `users:create` (staff Admins and Managers).
 * @param rawEmail - The email address.
 * @param options - How to set the account up.
 * @param options.locale - The new user's language, one Adiutor offers: saved as theirs
 *   (`user.locale`) and used for the welcome email. Without it, nothing is saved and the email is in Adiutor's default
 *   language, else English (US).
 * @returns What happened.
 * @throws {ServiceError} `forbidden` without `users:create`, `rate_limited` when sending too many,
 *   `invalid` for a language that isn't offered (`errors.language.notOffered`).
 */
export async function registerUser(
  ctx: ServiceContext,
  actor: Actor,
  rawEmail: string,
  options: { locale?: Locale } = {},
): Promise<RegisterResult> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'users:create');
  const email = emailSchema.parse(rawEmail);
  await assertLanguageOffered(ctx.db, options.locale);

  const [existing] = await ctx.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing) {
    return { status: 'exists', userId: existing.id };
  }
  await assertInviteSenderLimit(ctx, actor.id);

  const token = generateToken();
  let userId: string;
  try {
    userId = await ctx.db.transaction(async (tx) => {
      const created = firstRow(
        await tx
          .insert(user)
          .values({ name: '', email, emailVerified: false, locale: options.locale ?? null })
          .returning({ id: user.id }),
        'the new user',
      );
      await tx.insert(verification).values({
        // Hashed like Better Auth stores its own (`verification.storeIdentifier`).
        identifier: hashVerificationIdentifier(`reset-password:${token}`),
        value: created.id,
        expiresAt: sql`now() + make_interval(days => ${WELCOME_LINK_VALID_DAYS})`,
      });
      await recordEvent(
        ctx,
        {
          action: 'account_created',
          actorUserId: actor.id,
          targetUserId: created.id,
          details: { email },
        },
        tx,
      );
      return created.id;
    });
  } catch (error) {
    // Registered at the same moment by someone else.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = firstRow(
      await ctx.db.select({ id: user.id }).from(user).where(eq(user.email, email)),
      'the user registered at the same moment',
    );
    return { status: 'exists', userId: raced.id };
  }

  await ctx.sendEmail(
    await accountCreatedEmail(email, {
      appUrl: ctx.baseUrl,
      brand: await loadEmailBrand(ctx.db),
      locale: await recipientLocale(ctx, options.locale),
      creatorName: displayName(actor),
      staffName: await getStaffName(ctx.db),
      url: `${ctx.baseUrl}/auth/reset-password?token=${token}&welcome=1`,
      validDays: WELCOME_LINK_VALID_DAYS,
    }),
  );
  return { status: 'created', userId };
}
