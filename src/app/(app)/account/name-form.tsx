/**
 * @file Form to change the user's display name.
 */
'use client';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { NAME_MAX_LENGTH } from '@/lib/input-rules';

import { updateNameAction } from './actions';

/**
 * A name field with a save button.
 *
 * @param props - Form props.
 * @param props.name - The current name.
 * @returns The form.
 */
export default function NameForm({ name }: { name: string }) {
  const [result, formAction, pending, onSubmit] = useTransientActionState(updateNameAction, null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ResultAlert result={result} />
      <TextField
        label="Name"
        name="name"
        autoComplete="name"
        defaultValue={name}
        required
        maxLength={NAME_MAX_LENGTH}
      />
      <div>
        <Button type="submit" loading={pending}>
          Save name
        </Button>
      </div>
    </form>
  );
}
