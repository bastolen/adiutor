/**
 * @file The Largest file form on the Attachments tab of Settings: the most
 * megabytes a file anyone attaches may have. Its text comes from
 * `admin.settings.attachments.largestFile` (through `ClientMessages`).
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { useSetByEnvironment } from '@/components/ui/set-by-environment';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';

import { saveLargestFileAction } from './actions';

/**
 * A number field with a save button. While the server's environment
 * chooses the limit, the field shows it, can't be changed and says why, and
 * there's no button (it could only be refused).
 *
 * @param props - Form props.
 * @param props.value - The limit now, in megabytes.
 * @param props.ceiling - The most it may be where Adiutor runs.
 * @param props.locked - Whether the server's environment chooses it.
 */
export default function LargestFileForm({
  value,
  ceiling,
  locked,
}: {
  value: number;
  ceiling: number;
  locked: boolean;
}) {
  const t = useTranslations('admin.settings.attachments.largestFile');
  const setByEnvironment = useSetByEnvironment();
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveLargestFileAction,
    null,
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <TextField
          label={t('label')}
          name="maxFileMb"
          type="number"
          inputMode="numeric"
          min={1}
          max={ceiling}
          autoComplete="off"
          defaultValue={value}
          description={
            locked ? setByEnvironment('ATTACHMENTS_MAX_FILE_MB') : t('hint', { ceiling })
          }
          className="max-w-32"
          required
          disabled={locked || changesOff}
        />
        {!locked && (
          <div>
            <Button type="submit" loading={pending} disabled={changesOff}>
              {t('save')}
            </Button>
          </div>
        )}
      </ChangesFieldset>
    </form>
  );
}
