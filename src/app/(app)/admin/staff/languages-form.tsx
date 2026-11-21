/**
 * @file The staff page's Languages form: which languages Adiutor offers, and
 * its default language (decision 0029). Its text comes from
 * `admin.staff.languages` (through `ClientMessages`) and `common.language`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import DefaultLanguageField from '@/components/language/default-language-field';
import LanguageFlag from '@/components/language/language-flag';
import Button from '@/components/ui/button';
import CheckboxField from '@/components/ui/checkbox-field';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useOncePerVisit, useTransientActionState } from '@/components/ui/use-transient-state';
import { type Locale, LOCALE_NAMES, LOCALES } from '@/lib/i18n/locales';

import { saveLanguagesAction } from './actions';

/**
 * A checkbox per language, each with its flag and named in itself, then the
 * default language select and a save button. The default is always on: its
 * checkbox is checked and off, says why, and follows the select as it
 * changes; the select offers only the languages that are checked. Saving
 * says so in a toast; errors stay in the form, as alert and toast.
 *
 * The form isn't cleared after a save (`resetOnSuccess: false`): it edits
 * saved settings, and a reset would put the select back on the language it
 * showed when the page loaded. Each visit starts from the saved settings
 * (`useOncePerVisit`), so unsaved choices go when the user leaves the page,
 * and coming back after a save shows what was saved.
 *
 * @param props - Form props.
 * @param props.defaultLocale - Adiutor's default language now.
 * @param props.offered - The languages it offers now.
 * @returns The form.
 */
export default function LanguagesForm({
  defaultLocale,
  offered,
}: {
  defaultLocale: Locale;
  offered: readonly Locale[];
}) {
  const t = useTranslations('admin.staff.languages');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveLanguagesAction,
    null,
    { resetOnSuccess: false },
  );
  const [checked, setChecked] = useState<readonly Locale[]>(offered);
  const [chosenDefault, setChosenDefault] = useState<Locale>(defaultLocale);
  useOncePerVisit(() => {
    setChecked(offered);
    setChosenDefault(defaultLocale);
  });
  /**
   * Whether a language is on in the form: checked, or the default.
   *
   * @param locale - The language.
   * @returns Whether it's on.
   */
  const isOn = (locale: Locale) => locale === chosenDefault || checked.includes(locale);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium text-foreground">{t('offeredLabel')}</legend>
          {LOCALES.map((locale) => {
            const isDefault = locale === chosenDefault;
            return (
              <CheckboxField
                key={locale}
                name="offered"
                value={locale}
                checked={isOn(locale)}
                disabled={changesOff || isDefault}
                onChange={(event) => {
                  const on = event.currentTarget.checked;
                  setChecked((current) =>
                    on ? [...current, locale] : current.filter((value) => value !== locale),
                  );
                }}
                label={
                  <span className="inline-flex items-center gap-2">
                    <LanguageFlag locale={locale} />
                    <span lang={locale}>{LOCALE_NAMES[locale]}</span>
                  </span>
                }
                description={isDefault ? t('alwaysOn') : undefined}
              />
            );
          })}
        </fieldset>
        <DefaultLanguageField
          value={chosenDefault}
          onValueChange={setChosenDefault}
          languages={LOCALES.filter(isOn)}
          description={t('defaultHint')}
          disabled={changesOff}
        />
        <div>
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('save')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
