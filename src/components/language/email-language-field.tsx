/**
 * @file The "Email language" select of the forms that email someone who has
 * never chosen a language: invitations, Add user and Add company. It defaults
 * to the sender's own language; the email (and, for Add user, the new
 * account) uses the choice. Read it with `localeField` in the action.
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';

import SelectField from '@/components/ui/select-field';

import LANGUAGE_OPTIONS from './language-options';

/** Props of {@link EmailLanguageField}. */
interface EmailLanguageFieldProps {
  /** What the language is for: an invitation's email, or a new account and its welcome email. */
  purpose: 'invitation' | 'account';
}

/**
 * A select named `locale` with every language (with its flag), the sender's
 * chosen, and a hint saying what the language is for.
 *
 * @param props - Field props.
 * @param props.purpose - What the language is for, which the hint says.
 * @returns The field.
 */
export default function EmailLanguageField({ purpose }: EmailLanguageFieldProps) {
  const t = useTranslations('common.language');
  const locale = useLocale();
  return (
    <SelectField
      label={t('emailField')}
      name="locale"
      options={LANGUAGE_OPTIONS}
      defaultValue={locale}
      description={purpose === 'invitation' ? t('emailHintInvitation') : t('emailHintAccount')}
    />
  );
}
