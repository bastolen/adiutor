/**
 * @file Form to choose Adiutor's default time zone, on the General tab of Settings.
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import type { TimeZoneOption } from '@/lib/i18n/time-zones';

import { saveDefaultTimeZoneAction } from './actions';

/** Props for {@link DefaultTimeZoneForm}. */
interface DefaultTimeZoneFormProps {
  /** Adiutor's default zone now. */
  defaultTimeZone: string;
  /** Every zone to pick from, with its offset now (`timeZoneOptions`, made on the server). */
  options: readonly TimeZoneOption[];
}

/**
 * The default time zone select with a save button. Saving says so in a toast;
 * errors stay in the form, as alert and toast.
 *
 * The form isn't cleared after a save (`resetOnSuccess: false`): it edits a
 * saved setting, and clearing would put the select back on the zone it
 * showed when the page loaded, not the one just saved.
 *
 * @param props - Form props.
 * @param props.defaultTimeZone - Adiutor's default zone now.
 * @param props.options - The zones to pick from.
 * @returns The form.
 */
export default function DefaultTimeZoneForm({
  defaultTimeZone,
  options,
}: DefaultTimeZoneFormProps) {
  const t = useTranslations('admin.settings.general.timeZone');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveDefaultTimeZoneAction,
    null,
    { resetOnSuccess: false },
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <SelectField
          label={t('label')}
          name="defaultTimeZone"
          options={options}
          defaultValue={defaultTimeZone}
          className="sm:max-w-sm"
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
