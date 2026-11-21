/**
 * @file Stand-ins for next-intl in unit tests (registered in
 * `vitest.setup.ts`), so components, pages and actions render in English
 * (US) without a request or a provider:
 *
 * - `next-intl/server` (`getTranslations`, `getLocale`, `getMessages`,
 *   `getTimeZone`) reads {@link testLocale} and {@link testTimeZone}, as if
 *   the request were in that language and zone.
 * - `useTranslations`, `useLocale` and `useTimeZone` use the nearest provider
 *   when there is one (`renderInLocale` in `tests/i18n/render.tsx`), and
 *   English (US) and {@link testTimeZone} otherwise.
 * - `requestLocale()` returns {@link testLocale}.
 */
import type * as NextIntl from 'next-intl';

import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/time-zones';
import translator, { type Namespace } from '@/lib/i18n/translator';

/** The request's language in the next test; reset after each test. */
export const testLocale: { current: Locale } = { current: DEFAULT_LOCALE };

/** The request's time zone in the next test; reset after each test. UTC unless a test sets one. */
export const testTimeZone: { current: string } = { current: DEFAULT_TIME_ZONE };

/**
 * `next-intl/server` for tests: the request is in {@link testLocale}.
 *
 * @returns The module's stand-in.
 */
export function nextIntlServerMock() {
  return {
    /**
     * Translations for a namespace, as `getTranslations` gives them.
     *
     * @param options - The namespace, or `{ locale, namespace }`.
     * @returns `t`.
     */
    getTranslations: async (options?: Namespace | { locale?: Locale; namespace?: Namespace }) => {
      const { locale = testLocale.current, namespace } =
        typeof options === 'string' ? { namespace: options } : (options ?? {});
      return translator(locale, namespace ?? ('common' as const));
    },
    /**
     * The request's language.
     *
     * @returns The language in `testLocale`.
     */
    getLocale: async () => testLocale.current,
    /**
     * The request's messages.
     *
     * @returns Every message in {@link testLocale}.
     */
    getMessages: async () => messagesFor(testLocale.current),
    /**
     * The request's time zone.
     *
     * @returns The zone in {@link testTimeZone}.
     */
    getTimeZone: async () => testTimeZone.current,
  };
}

/**
 * `next-intl` for tests: the real hooks inside a provider, English (US)
 * outside one.
 *
 * @param actual - The real module.
 * @returns The module's stand-in.
 */
export function nextIntlMock(actual: typeof NextIntl) {
  return {
    ...actual,
    /**
     * Translations for a namespace, from the provider or in English (US).
     *
     * @param namespace - The namespace.
     * @returns `t`.
     */
    useTranslations: (namespace?: Namespace) => {
      try {
        return actual.useTranslations(namespace);
      } catch {
        // No provider around the component: the test didn't ask for a language.
        return translator(DEFAULT_LOCALE, namespace ?? ('common' as const));
      }
    },
    /**
     * The provider's language, or English (US).
     *
     * @returns The locale.
     */
    useLocale: () => {
      try {
        return actual.useLocale();
      } catch {
        return DEFAULT_LOCALE;
      }
    },
    /**
     * The provider's time zone, or {@link testTimeZone}.
     *
     * @returns The zone.
     */
    useTimeZone: () => {
      try {
        return actual.useTimeZone() ?? testTimeZone.current;
      } catch {
        return testTimeZone.current;
      }
    },
  };
}
