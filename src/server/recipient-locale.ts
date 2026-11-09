/**
 * @file Which language an email goes out in: the recipient's own saved
 * language, else the language of the request that caused the email, else
 * Adiutor's default language, else English (US). See "Which language" in
 * docs/email.md.
 */
import { loadDefaultLocale } from '@/lib/i18n/default-locale';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locales';

import type { ServiceContext } from './context';

/**
 * Works out the language of an email to someone.
 *
 * @param ctx - Service context; its `requestLocale` is the request that caused the email, if
 *   any, and its database holds Adiutor's default language for when there's none.
 * @param saved - The recipient's saved language (`user.locale`, or an invitation's), if any.
 * @returns The locale to write the email in.
 */
export default async function recipientLocale(
  ctx: Pick<ServiceContext, 'db' | 'requestLocale'>,
  saved?: string | null,
): Promise<Locale> {
  if (isLocale(saved)) {
    return saved;
  }
  const fromRequest = await ctx.requestLocale?.().catch(() => null);
  if (fromRequest) {
    return fromRequest;
  }
  // Outside a request (the hourly job, scripts): Adiutor's default language.
  return (await loadDefaultLocale(ctx.db)) ?? DEFAULT_LOCALE;
}
