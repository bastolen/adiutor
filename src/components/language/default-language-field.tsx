/**
 * @file The "Default language" select: Adiutor's own language for everyone
 * who hasn't chosen one (`staff_settings.default_locale`), on the setup form
 * and the staff page. Read it with `field(formData, 'defaultLocale')`.
 */
'use client';

import { useTranslations } from 'next-intl';

import SelectField from '@/components/ui/select-field';
import type { Locale } from '@/lib/i18n/locales';

import LANGUAGE_OPTIONS from './language-options';

/** Props of {@link DefaultLanguageField}. */
interface DefaultLanguageFieldProps {
  /** The language chosen to begin with: the current default, or the page's language at setup. */
  defaultValue: Locale;
  /** Help text under the field, if any. */
  description?: string;
  /** Turn the field off, e.g. while changes are turned off. */
  disabled?: boolean;
}

/**
 * A select named `defaultLocale` with every language, each with its flag and
 * named in itself.
 *
 * @param props - Field props.
 * @param props.defaultValue - The language chosen to begin with.
 * @param props.description - Help text under the field.
 * @param props.disabled - Turn the field off.
 * @returns The field.
 */
export default function DefaultLanguageField({
  defaultValue,
  description = undefined,
  disabled = false,
}: DefaultLanguageFieldProps) {
  const t = useTranslations('common.language');
  return (
    <SelectField
      label={t('defaultLabel')}
      name="defaultLocale"
      options={LANGUAGE_OPTIONS}
      defaultValue={defaultValue}
      description={description}
      disabled={disabled}
      className="sm:max-w-xs"
    />
  );
}
