/**
 * @file Form to rename the staff. Its text comes from `admin.settings.general.name`, so
 * the page passes `admin` through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { NAME_MAX_LENGTH } from '@/lib/input-rules';

import renameStaffAction from './actions';

/**
 * A name field with a save button.
 *
 * @param props - Form props.
 * @param props.name - The current name.
 */
export default function StaffNameForm({ name }: { name: string }) {
  const t = useTranslations('admin.settings.general.name');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(renameStaffAction, null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <TextField
          label={t('label')}
          name="name"
          maxLength={NAME_MAX_LENGTH}
          defaultValue={name}
          autoComplete="organization"
          description={t('example')}
          required
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
