/**
 * @file Form to choose the user's language, on the account's Profile page.
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

import LANGUAGE_OPTIONS from '@/components/language/language-options';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';

import { saveLanguageAction } from './actions';

/**
 * A language select with a save button. Saving reloads the page in the new
 * language (a soft refresh would leave pages kept alive in the old one), at
 * the address the action gives, where the page says it's saved. Errors stay in
 * the form, as alert and toast.
 *
 * The reload sets that address and reloads, rather than `location.assign`:
 * after one change the page is already at it, and going to the same address
 * with a `#section` only scrolls, which would leave the button busy.
 *
 * @returns The form.
 */
export default function LanguageForm() {
  const t = useTranslations('account');
  const locale = useLocale();
  const [result, formAction, pending, onSubmit] = useTransientActionState(saveLanguageAction, null);

  useEffect(() => {
    if (result?.ok && result.data) {
      // Keeps the router's history state; only the address changes before the reload.
      window.history.replaceState(window.history.state, '', result.data);
      window.location.reload();
    }
  }, [result]);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      {result && !result.ok && <ResultAlert result={result} />}
      <SelectField
        label={t('profile.languageLabel')}
        name="locale"
        options={LANGUAGE_OPTIONS}
        defaultValue={locale}
        className="sm:max-w-xs"
      />
      <div>
        {/* Busy until the page has reloaded, so nobody presses it twice. */}
        <Button type="submit" loading={pending || Boolean(result?.ok)}>
          {t('profile.saveLanguage')}
        </Button>
      </div>
    </form>
  );
}
