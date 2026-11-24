/**
 * @file Form to change the user's display name.
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { NAME_MAX_LENGTH } from '@/lib/input-rules';

import { updateNameAction } from './actions';

/**
 * A name field with a save button.
 *
 * @param props - Form props.
 * @param props.name - The current name.
 */
export default function NameForm({ name }: { name: string }) {
  const t = useTranslations('account');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(updateNameAction, null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <TextField
          label={t('profile.nameLabel')}
          name="name"
          autoComplete="name"
          defaultValue={name}
          required
          maxLength={NAME_MAX_LENGTH}
          disabled={changesOff}
        />
        <div>
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('profile.saveName')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
