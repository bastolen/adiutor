/**
 * @file First-run form: the staff name, Adiutor's default language and its
 * first Admin.
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';

import DefaultLanguageField from '@/components/language/default-language-field';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH } from '@/lib/input-rules';

import setupAction from './actions';

/**
 * Name shown to users, default language (the page's to begin with), name,
 * email and password, with a button that sets everything up and signs in.
 *
 * @returns The form.
 */
export default function SetupForm() {
  const t = useTranslations('auth');
  const [result, formAction, pending, onSubmit] = useTransientActionState(setupAction, null);
  const language = useTranslations('common.language');
  const locale = useLocale();

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ResultAlert result={result} errorsOnly />
      <TextField
        label={t('setup.staffName')}
        name="staffName"
        maxLength={NAME_MAX_LENGTH}
        autoComplete="organization"
        placeholder={t('setup.staffNamePlaceholder')}
        description={t('setup.staffNameHint')}
        required
      />
      <DefaultLanguageField defaultValue={locale} description={language('defaultHint')} />
      <TextField
        label={t('fields.yourName')}
        name="name"
        autoComplete="name"
        required
        maxLength={NAME_MAX_LENGTH}
      />
      <TextField
        label={t('fields.email')}
        type="email"
        name="email"
        autoComplete="email"
        placeholder={t('fields.emailPlaceholder')}
        required
      />
      <TextField
        label={t('fields.password')}
        type="password"
        name="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        description={t('fields.passwordHint', { min: MIN_PASSWORD_LENGTH })}
        required
      />
      <Button type="submit" fullWidth loading={pending}>
        {t('setup.submit')}
      </Button>
    </form>
  );
}
