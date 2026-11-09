/**
 * @file The signed-in user's own language: saved with the account, so emails
 * reach them in it and every browser they sign in on shows it (the language
 * cookie is set at sign-in from it, `rememberLanguage`). Not a security
 * change: no audit event or notice.
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';
import type { Locale } from '@/lib/i18n/locales';
import { localeSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';

/**
 * Saves the user's own language. Anyone signed in may choose theirs, and only
 * theirs.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param locale - The language, as the form sent it.
 * @returns The saved language.
 * @throws {ZodError} When it isn't one of the languages.
 */
export default async function setOwnLocale(
  ctx: ServiceContext,
  actor: Actor,
  locale: unknown,
): Promise<Locale> {
  const chosen = localeSchema.parse(locale);
  await ctx.db.update(user).set({ locale: chosen }).where(eq(user.id, actor.id));
  return chosen;
}
