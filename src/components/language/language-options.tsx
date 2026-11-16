/**
 * @file The languages as select options, each named in itself with its flag,
 * for the Language card, Email language and Default language selects, and the
 * Default choice that follows Adiutor's default language.
 */
import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { SelectOption } from '@/components/ui/select-field';
import { FOLLOW_DEFAULT, type Locale, LOCALE_NAMES, LOCALES } from '@/lib/i18n/locales';

import LanguageFlag from './language-flag';

/**
 * Every language, in menu order, named in itself (so people find their own)
 * and with its flag. Each name carries its language (`lang`), so a screen
 * reader says "Nederlands" in Dutch whatever language the page is in.
 */
const LANGUAGE_OPTIONS: SelectOption[] = LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
  icon: <LanguageFlag locale={locale} />,
  lang: locale,
}));

/**
 * The Default choice's picture, in the flags' place and at their size: a
 * globe, so it doesn't look like one of the languages.
 *
 * @returns The decorative icon.
 */
export function FollowDefaultIcon() {
  return (
    <span aria-hidden="true" className="inline-flex h-3.5 w-5 items-center justify-center">
      <Globe className="size-3.5 text-muted-foreground" />
    </span>
  );
}

/**
 * The options for choosing someone's language: Default first, described with
 * the language it stands for now ("Follows Adiutor's default language, now
 * English (US)."), then every language. Reads `common.language` from the root
 * provider.
 *
 * @param defaultLocale - Adiutor's default language, as chosen on the staff page.
 * @returns The options.
 */
export function useLanguageChoiceOptions(defaultLocale: Locale): SelectOption[] {
  const t = useTranslations('common.language');
  return [
    {
      value: FOLLOW_DEFAULT,
      label: t('followDefault'),
      description: t('followDefaultDescription', { language: LOCALE_NAMES[defaultLocale] }),
      icon: <FollowDefaultIcon />,
    },
    ...LANGUAGE_OPTIONS,
  ];
}

export default LANGUAGE_OPTIONS;
