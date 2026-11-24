/**
 * @file The "Default language" select: Adiutor's own language for everyone
 * who hasn't chosen one (the `staff.default_locale` setting), on the setup form
 * and the Languages card in Settings. Read it with
 * `field(formData, 'defaultLocale')`.
 */
'use client';

import { useTranslations } from 'next-intl';

import SelectField from '@/components/ui/select-field';
import { isLocale, type Locale } from '@/lib/i18n/locales';

import LANGUAGE_OPTIONS from './language-options';

/** Props of {@link DefaultLanguageField}. */
interface DefaultLanguageFieldProps {
  /** The language chosen to begin with, uncontrolled: the page's language at setup. */
  defaultValue?: Locale;
  /** The language chosen, controlled: Settings follows it for the offered languages. */
  value?: Locale;
  /** Called with the language once one is chosen (with `value`). */
  onValueChange?: (locale: Locale) => void;
  /** The languages to choose from; every language when left out (setup). */
  languages?: readonly Locale[];
  /** Help text under the field, if any. */
  description?: string;
  /** Turn the field off, e.g. while changes are turned off. */
  disabled?: boolean;
}

/**
 * A select named `defaultLocale` with the languages, each with its flag and
 * named in itself: every language at setup, the offered ones on the staff
 * page.
 *
 * @returns The field.
 */
export default function DefaultLanguageField({
  defaultValue = undefined,
  value = undefined,
  onValueChange = undefined,
  languages = undefined,
  description = undefined,
  disabled = false,
}: DefaultLanguageFieldProps) {
  const t = useTranslations('common.language');
  const options = languages
    ? LANGUAGE_OPTIONS.filter(({ value: option }) => isLocale(option) && languages.includes(option))
    : LANGUAGE_OPTIONS;
  return (
    <SelectField
      label={t('defaultLabel')}
      name="defaultLocale"
      options={options}
      defaultValue={defaultValue}
      value={value}
      onValueChange={
        onValueChange &&
        ((chosen) => {
          if (isLocale(chosen)) {
            onValueChange(chosen);
          }
        })
      }
      description={description}
      disabled={disabled}
      className="sm:max-w-xs"
    />
  );
}
