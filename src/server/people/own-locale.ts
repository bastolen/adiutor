/**
 * @file The signed-in user's own language: saved with the account, so emails
 * reach them in it and every browser they sign in on shows it (the language
 * cookie is set at sign-in from it, `rememberLanguage`), or Default, which
 * saves none and follows Adiutor's default language. Not a security change:
 * no audit event or notice.
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';
import { FOLLOW_DEFAULT, isLocale, type LanguageChoice, type Locale } from '@/lib/i18n/locales';
import { languageChoiceSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { defaultLanguage } from '../recipient-locale';

/**
 * Saves the user's own language choice. Anyone signed in may choose theirs,
 * and only theirs.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param choice - A language, or `FOLLOW_DEFAULT`, as the form sent it.
 * @returns The saved language, or `null` for Default.
 * @throws {ZodError} When it's neither (`validation.locale`).
 */
export default async function setOwnLocale(
  ctx: ServiceContext,
  actor: Actor,
  choice: unknown,
): Promise<Locale | null> {
  const chosen = languageChoiceSchema.parse(choice);
  const locale = chosen === FOLLOW_DEFAULT ? null : chosen;
  await ctx.db.update(user).set({ locale }).where(eq(user.id, actor.id));
  return locale;
}

/**
 * The user's own language choice, for the account's Language card, with
 * Adiutor's default language so the card can name it.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @returns Their choice (a language, or `FOLLOW_DEFAULT`) and the default language.
 */
export async function ownLanguage(
  ctx: ServiceContext,
  actor: Actor,
): Promise<{ choice: LanguageChoice; defaultLocale: Locale }> {
  const [[found], defaultLocale] = await Promise.all([
    ctx.db.select({ locale: user.locale }).from(user).where(eq(user.id, actor.id)),
    defaultLanguage(ctx),
  ]);
  return { choice: isLocale(found?.locale) ? found.locale : FOLLOW_DEFAULT, defaultLocale };
}
