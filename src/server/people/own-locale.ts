/**
 * @file The signed-in user's own language: saved with the account, so emails
 * reach them in it and every browser they sign in on shows it (the language
 * cookie is set at sign-in from it, `rememberLanguage`), or Default, which
 * saves none and follows Adiutor's default language. A person's own choice
 * is only saved here, when they make it signed in: on the account page's
 * Language card, or in the theme and language menu of a page they reach
 * signed in. A language cookie at sign-in never is (decision 0020). Not a
 * security change: no audit event or notice.
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';
import { loadLanguageSettings } from '@/lib/i18n/default-locale';
import {
  DEFAULT_LOCALE,
  FOLLOW_DEFAULT,
  isLocale,
  type LanguageChoice,
  type Locale,
  offeredLocale,
} from '@/lib/i18n/locales';
import { languageChoiceSchema } from '@/lib/validation';

import { assertNotSignedInAs } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import assertLanguageOffered from '../offered-language';

/**
 * Saves the user's own language choice. Anyone signed in may choose theirs,
 * and only theirs.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param choice - A language, or `FOLLOW_DEFAULT`, as the form sent it.
 * @returns The saved language, or `null` for Default.
 * @throws {ZodError} When it's neither (`validation.locale`).
 * @throws {ServiceError} `invalid` for a language that isn't offered
 *   (`errors.language.notOffered`).
 */
export default async function setOwnLocale(
  ctx: ServiceContext,
  actor: Actor,
  choice: unknown,
): Promise<Locale | null> {
  assertNotSignedInAs(actor);
  const chosen = languageChoiceSchema.parse(choice);
  const locale = chosen === FOLLOW_DEFAULT ? null : chosen;
  await assertLanguageOffered(ctx.db, locale);
  await ctx.db.update(user).set({ locale }).where(eq(user.id, actor.id));
  return locale;
}

/**
 * The user's own language choice, for the account's Language card, with
 * Adiutor's default language so the card can name it. A saved language
 * that's turned off counts as Default, which is what they get meanwhile;
 * it's named apart so the card can say so (decision 0029).
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @returns Their choice (a language, or `FOLLOW_DEFAULT`), the default language, their saved
 *   language when it's off (else `null`), and the languages offered.
 */
export async function ownLanguage(
  ctx: ServiceContext,
  actor: Actor,
): Promise<{
  choice: LanguageChoice;
  defaultLocale: Locale;
  notOffered: Locale | null;
  offered: readonly Locale[];
}> {
  const [[found], settings] = await Promise.all([
    ctx.db.select({ locale: user.locale }).from(user).where(eq(user.id, actor.id)),
    loadLanguageSettings(ctx.db),
  ]);
  const saved = isLocale(found?.locale) ? found.locale : null;
  const choice = offeredLocale(saved, settings.offered);
  return {
    choice: choice ?? FOLLOW_DEFAULT,
    defaultLocale: settings.defaultLocale ?? DEFAULT_LOCALE,
    notOffered: saved && !choice ? saved : null,
    offered: settings.offered,
  };
}
