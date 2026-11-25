/**
 * @file The "Email language" select of the forms that email someone who has
 * never chosen a language: invitations, Add user and Add company. The email
 * (and, for Add user, the new account) uses the choice. Add user and Add
 * company offer Default first and start on it: the email goes out in
 * Adiutor's default language, and a new account keeps following it. The
 * invite form starts on the sender's own language. Only the languages
 * Adiutor offers are choices, and with just one there's nothing to choose:
 * the field doesn't show, and the email goes out in the default language.
 * Read it with `localeField` in the action, which gives `undefined` for
 * Default (and for no field).
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';

import SelectField from '@/components/ui/select-field';
import { FOLLOW_DEFAULT, type Locale } from '@/lib/i18n/locales';

import { useLanguageChoiceOptions, useOfferedLanguageOptions } from './language-options';

/** Props of {@link EmailLanguageField}. */
interface EmailLanguageFieldProps {
  /** What the language is for: an invitation's email, or a new account and its welcome email. */
  purpose: 'invitation' | 'account';
  /**
   * Adiutor's default language. When given, Default comes first (naming this
   * language) and is chosen; otherwise the sender's own language is.
   */
  defaultLocale?: Locale | null;
  /** Turn the field off, e.g. while changes are turned off. */
  disabled?: boolean;
}

/**
 * A select named `locale` with the languages Adiutor offers (with their
 * flags), Default first when the form offers it, and a hint saying what the
 * language is for; nothing with only one language offered.
 *
 * @returns The field, or nothing.
 */
export default function EmailLanguageField({
  purpose,
  defaultLocale = null,
  disabled = false,
}: EmailLanguageFieldProps) {
  const t = useTranslations('common.language');
  const locale = useLocale();
  const choices = useLanguageChoiceOptions(defaultLocale ?? locale);
  const languages = useOfferedLanguageOptions();
  if (languages.length <= 1) {
    return null;
  }
  return (
    <SelectField
      label={t('emailField')}
      name="locale"
      options={defaultLocale ? choices : languages}
      defaultValue={defaultLocale ? FOLLOW_DEFAULT : locale}
      description={purpose === 'invitation' ? t('emailHintInvitation') : t('emailHintAccount')}
      disabled={disabled}
    />
  );
}
