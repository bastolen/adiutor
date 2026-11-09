/**
 * @file Form to choose Adiutor's default language, on the staff page.
 */
'use client';

import { useTranslations } from 'next-intl';

import DefaultLanguageField from '@/components/language/default-language-field';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import type { Locale } from '@/lib/i18n/locales';

import { saveDefaultLanguageAction } from './actions';

/**
 * The default language select with a save button. Saving says so in a toast;
 * errors stay in the form, as alert and toast.
 *
 * The form isn't cleared after a save (`resetOnSuccess: false`): it edits a
 * saved setting, so there's nothing to clear, and clearing would put the
 * select back on the language it showed when the page loaded (Radix Select
 * restores that on a form reset), not the one just saved.
 *
 * @param props - Form props.
 * @param props.defaultLocale - Adiutor's default language now.
 * @returns The form.
 */
export default function DefaultLanguageForm({ defaultLocale }: { defaultLocale: Locale }) {
  const t = useTranslations('common.language');
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveDefaultLanguageAction,
    null,
    { resetOnSuccess: false },
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ResultAlert result={result} />
      <DefaultLanguageField defaultValue={defaultLocale} />
      <div>
        <Button type="submit" loading={pending}>
          {t('saveDefault')}
        </Button>
      </div>
    </form>
  );
}
