/**
 * @file Form to choose the user's time zone, on the account's Profile page.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';

import Button from '@/components/ui/button';
import loadFresh from '@/components/ui/load-fresh';
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState, useTransientState } from '@/components/ui/use-transient-state';
import { compareTimeZoneOptions, type TimeZoneOption, timeZoneOption } from '@/lib/i18n/time-zones';
import useBrowserTimeZone from '@/lib/i18n/use-browser-time-zone';
import useTimeZoneChoices from '@/lib/i18n/use-time-zone-choices';

import { saveTimeZoneAction } from './actions';

/** Props for {@link TimeZoneForm}. */
interface TimeZoneFormProps {
  /** The account's zone, or Adiutor's default while it has none: what the select starts on. */
  timeZone: string;
  /** Every zone to pick from, by region, with its offset now (`timeZoneOptions`, made on the server). */
  options: readonly TimeZoneOption[];
}

/**
 * A zone select with a save button, starting on the account's zone, and a
 * button that picks this browser's zone (it stays, focusable but unavailable,
 * once that zone is chosen, so focus stays where it was). Saving reloads the
 * page at the address the action gives, so every page kept alive shows the
 * new times, and the page says it's saved. Errors stay in the form, as alert
 * and toast.
 *
 * The list comes from the server, so the page and the browser agree on it,
 * with each zone under its region's heading (`useTimeZoneChoices`); it has
 * a search field, being long. A browser may name its zone in a way the
 * server's list doesn't (an older or a newer name, like `Asia/Kolkata`):
 * that zone is added to the list, in its place.
 *
 * @param props - Component props.
 * @param props.timeZone - The zone the select starts on.
 * @param props.options - The zones to pick from.
 * @returns The form.
 */
export default function TimeZoneForm({ timeZone, options }: TimeZoneFormProps) {
  const t = useTranslations('account');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const browser = useBrowserTimeZone();
  const [chosen, setChosen] = useTransientState(timeZone);
  const [result, formAction, pending, onSubmit] = useTransientActionState(saveTimeZoneAction, null);
  const zones = useMemo(() => {
    if (!browser || options.some(({ value }) => value === browser)) {
      return options;
    }
    return [...options, timeZoneOption(browser, new Date())].sort(compareTimeZoneOptions);
  }, [browser, options]);
  const choices = useTimeZoneChoices(zones);

  useEffect(() => {
    if (result?.ok && result.data) {
      loadFresh(result.data);
    }
  }, [result]);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        {result && !result.ok && <ResultAlert result={result} />}
        <SelectField
          label={t('profile.timeZoneLabel')}
          name="timeZone"
          options={choices}
          value={chosen}
          onValueChange={setChosen}
          className="sm:max-w-sm"
          disabled={changesOff}
          description={browser ? t('profile.browserTimeZone', { zone: browser }) : ''}
        />
        <div className="flex flex-wrap gap-3">
          {/* Busy until the page has reloaded, so nobody presses it twice. */}
          <Button type="submit" loading={pending || Boolean(result?.ok)} disabled={changesOff}>
            {t('profile.saveTimeZone')}
          </Button>
          {browser && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setChosen(browser)}
              disabled={changesOff || chosen === browser}
              focusableWhenDisabled
            >
              {t('profile.useBrowserTimeZone')}
            </Button>
          )}
        </div>
      </ChangesFieldset>
    </form>
  );
}
