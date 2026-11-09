/**
 * @file The "Email language" select of the forms that email someone who has
 * never chosen a language: invitations, Add user and Add company. The email
 * (and, for Add user, the new account) uses the choice. Add user and Add
 * company offer Default first and start on it: the email goes out in
 * Adiutor's default language, and a new account keeps following it. The
 * invite form starts on the sender's own language. Read it with `localeField`
 * in the action, which gives `undefined` for Default.
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';

import SelectField from '@/components/ui/select-field';
import { FOLLOW_DEFAULT, type Locale } from '@/lib/i18n/locales';

import LANGUAGE_OPTIONS, { useLanguageChoiceOptions } from './language-options';

/** Props of {@link EmailLanguageField}. */
interface EmailLanguageFieldProps {
  /** What the language is for: an invitation's email, or a new account and its welcome email. */
  purpose: 'invitation' | 'account';
  /**
   * Adiutor's default language. When given, Default comes first (naming this
   * language) and is chosen; otherwise the sender's own language is.
   */
  defaultLocale?: Locale | null;
}

/**
 * A select named `locale` with every language (with its flag), Default first
 * when the form offers it, and a hint saying what the language is for.
 *
 * @param props - Field props.
 * @param props.purpose - What the language is for, which the hint says.
 * @param props.defaultLocale - Adiutor's default language, to offer Default.
 * @returns The field.
 */
export default function EmailLanguageField({
  purpose,
  defaultLocale = null,
}: EmailLanguageFieldProps) {
  const t = useTranslations('common.language');
  const locale = useLocale();
  const choices = useLanguageChoiceOptions(defaultLocale ?? locale);
  return (
    <SelectField
      label={t('emailField')}
      name="locale"
      options={defaultLocale ? choices : LANGUAGE_OPTIONS}
      defaultValue={defaultLocale ? FOLLOW_DEFAULT : locale}
      description={purpose === 'invitation' ? t('emailHintInvitation') : t('emailHintAccount')}
    />
  );
}
