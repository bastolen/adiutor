/**
 * @file Which language an email goes out in: the recipient's own saved
 * language, else Adiutor's default language (they're on Default), else
 * English (US). The language of whoever caused the email doesn't count: a
 * staff Admin browsing in Dutch doesn't send a user on Default a Dutch
 * notice. Only an email to the person making the request (an invite link's
 * confirmation) follows the language their browser shows. See "Which
 * language" in docs/email.md.
 */
import { loadDefaultLocale } from '@/lib/i18n/default-locale';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locales';

import type { ServiceContext } from './context';

/**
 * Adiutor's default language, as chosen on the staff page.
 *
 * @param ctx - Service context; its database holds the setting.
 * @returns The default language, or English (US) before setup.
 */
export async function defaultLanguage(ctx: Pick<ServiceContext, 'db'>): Promise<Locale> {
  return (await loadDefaultLocale(ctx.db)) ?? DEFAULT_LOCALE;
}

/**
 * Works out the language of an email to someone.
 *
 * @param ctx - Service context; its database holds Adiutor's default language.
 * @param saved - The recipient's saved language (`user.locale`, or an invitation's), if any.
 * @returns The locale to write the email in.
 */
export default async function recipientLocale(
  ctx: Pick<ServiceContext, 'db'>,
  saved?: string | null,
): Promise<Locale> {
  return isLocale(saved) ? saved : defaultLanguage(ctx);
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
