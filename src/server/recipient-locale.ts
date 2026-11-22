/**
 * @file Which language an email goes out in: the recipient's own saved
 * language while Adiutor offers it, else Adiutor's default language (they're
 * on Default, or chose a language that's turned off), else English (US). The language of whoever caused the email doesn't count: a
 * staff Admin browsing in Dutch doesn't send a user on Default a Dutch
 * notice. Only an email to the person making the request (an invite link's
 * confirmation) follows the language their browser shows. See "Which
 * language" in docs/email.md.
 */
import { loadDefaultLocale, loadLanguageSettings } from '@/lib/i18n/default-locale';
import { DEFAULT_LOCALE, type Locale, offeredLocale } from '@/lib/i18n/locales';

import type { ServiceContext } from './context';

/**
 * Adiutor's default language, as chosen in Settings.
 *
 * @param ctx - Service context; its database holds the setting.
 * @returns The default language, or English (US) before setup.
 */
export async function defaultLanguage(ctx: Pick<ServiceContext, 'db'>): Promise<Locale> {
  return (await loadDefaultLocale(ctx.db)) ?? DEFAULT_LOCALE;
}

/**
 * Works out the language of an email to someone: the first of the languages
 * it's given that Adiutor offers (their saved language, then e.g. the
 * invitation's), else the default. A language that's turned off is skipped,
 * so they get the default until it's on again (decision 0029).
 *
 * @param ctx - Service context; its database holds Adiutor's language settings.
 * @param saved - The recipient's languages in order (`user.locale`, an invitation's), if any.
 * @returns The locale to write the email in.
 */
export default async function recipientLocale(
  ctx: Pick<ServiceContext, 'db'>,
  ...saved: (string | null | undefined)[]
): Promise<Locale> {
  const { defaultLocale, offered } = await loadLanguageSettings(ctx.db);
  const chosen = saved.map((locale) => offeredLocale(locale, offered)).find(Boolean);
  return chosen ?? defaultLocale ?? DEFAULT_LOCALE;
}

/**
 * Works out the language of an email to whoever made the request, who asked
 * for it themselves (e.g. by opening an invite link): the language their
 * browser shows, else Adiutor's default language.
 *
 * @param ctx - Service context; its `requestLocale` reads the request's language, if there is
 *   a request.
 * @returns The locale to write the email in.
 */
export async function requesterLocale(
  ctx: Pick<ServiceContext, 'db' | 'requestLocale'>,
): Promise<Locale> {
  const fromRequest = await ctx.requestLocale?.().catch(() => null);
  return fromRequest ?? defaultLanguage(ctx);
}
