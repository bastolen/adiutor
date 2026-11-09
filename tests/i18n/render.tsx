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
import { TIME_ZONE } from '@/lib/i18n/time-zone';

/**
 * Renders a component inside a provider with every message in a language.
 *
 * @param locale - The language.
 * @param ui - The component.
 * @returns Testing Library's render result.
 */
export default function renderInLocale(locale: Locale, ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone={TIME_ZONE}>
      {ui}
    </NextIntlClientProvider>,
  );
}
