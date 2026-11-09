/**
 * @file The languages as select options, each named in itself with its flag,
 * for the Language card, Email language and Default language selects.
 */
import type { SelectOption } from '@/components/ui/select-field';
import { LOCALE_NAMES, LOCALES } from '@/lib/i18n/locales';

import LanguageFlag from './language-flag';

/** Every language, in menu order, named in itself (so people find their own) and with its flag. */
const LANGUAGE_OPTIONS: SelectOption[] = LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
  icon: <LanguageFlag locale={locale} />,
}));

export default LANGUAGE_OPTIONS;
