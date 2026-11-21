/**
 * @file Renders a component in a given language, for unit tests that check
 * Dutch or Spanish text (word order, plurals). Without it, components render
 * in English (US) (`tests/i18n/next-intl-mocks.ts`).
 */
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';

import type { Locale } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/time-zones';

/**
 * Renders a component inside a provider with every message in a language,
 * and a time zone (UTC unless the test gives one).
 *
 * @param locale - The language.
 * @param ui - The component.
 * @param timeZone - The zone times are shown in.
 * @returns Testing Library's render result.
 */
export default function renderInLocale(
  locale: Locale,
  ui: ReactElement,
  timeZone: string = DEFAULT_TIME_ZONE,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone={timeZone}>
      {ui}
    </NextIntlClientProvider>,
  );
}
