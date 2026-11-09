/**
 * @file Form to rename the staff. Its text comes from `admin.staff.name`, so
 * the page passes `admin` through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { NAME_MAX_LENGTH } from '@/lib/input-rules';

import renameStaffAction from './actions';

/**
 * A name field with a save button.
 *
 * @param props - Form props.
 * @param props.name - The current name.
 * @returns The form.
 */
export default function StaffNameForm({ name }: { name: string }) {
  const t = useTranslations('admin.staff.name');
  const [result, formAction, pending, onSubmit] = useTransientActionState(renameStaffAction, null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ResultAlert result={result} />
      <TextField
        label={t('label')}
        name="name"
        maxLength={NAME_MAX_LENGTH}
        defaultValue={name}
        autoComplete="organization"
        description={t('example')}
        required
      />
      <div>
        <Button type="submit" loading={pending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
