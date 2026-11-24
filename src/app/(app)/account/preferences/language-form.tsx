/**
 * @file Form to choose the user's language, on the account's Preferences tab.
 */
'use client';

import { useTranslations } from 'next-intl';

import { useLanguageChoiceOptions } from '@/components/language/language-options';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import useLoadFreshOnSuccess from '@/components/ui/use-load-fresh-on-success';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { type LanguageChoice, type Locale, LOCALE_NAMES } from '@/lib/i18n/locales';

import { saveLanguageAction } from '../actions';

/** Props for {@link LanguageForm}. */
interface LanguageFormProps {
  /** The account's saved choice: a language, or Default (`FOLLOW_DEFAULT`). */
  choice: LanguageChoice;
  /** Adiutor's default language, named in the Default option. */
  defaultLocale: Locale;
  /**
   * The account's saved language while it's turned off (the choice then
   * starts on Default, which is what applies), else `null`.
   */
  notOffered?: Locale | null;
}

/**
 * A language select with a save button, starting on the account's saved
 * choice. Default comes first: it saves no language, so the account follows
 * Adiutor's default language, also after a staff Admin changes it. Only the
 * languages Adiutor offers are choices; a saved language that's turned off
 * starts the select on Default, and the field says so (decision 0029). Saving
 * reloads the page in the new language (a soft refresh would leave pages kept
 * alive in the old one), at the address the action gives, where the page says
 * it's saved. Errors stay in the form, as alert and toast.
 *
 * The reload is `useLoadFreshOnSuccess`, which also works when the page is
 * already at that address after an earlier change (going to the same address
 * with a `#section` would only scroll, and leave the button busy).
 */
export default function LanguageForm({
  choice,
  defaultLocale,
  notOffered = null,
}: LanguageFormProps) {
  const t = useTranslations('account');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const options = useLanguageChoiceOptions(defaultLocale);
  const [result, formAction, pending, onSubmit] = useTransientActionState(saveLanguageAction, null);
  const leaving = useLoadFreshOnSuccess(result);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        {result && !result.ok && <ResultAlert result={result} />}
        <SelectField
          label={t('profile.languageLabel')}
          name="locale"
          options={options}
          defaultValue={choice}
          description={
            notOffered
              ? t('profile.languageNotOffered', { language: LOCALE_NAMES[notOffered] })
              : undefined
          }
          className="sm:max-w-xs"
          disabled={changesOff}
        />
        <div>
          {/* Busy until the page has reloaded, so nobody presses it twice. */}
          <Button type="submit" loading={pending || leaving} disabled={changesOff}>
            {t('profile.saveLanguage')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
