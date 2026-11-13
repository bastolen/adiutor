/**
 * @file Form to choose the prefix request numbers are shown with ("AD" in
 * "AD-142"). Its text comes from `admin.staff.requestNumbers`, which the
 * page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { REQUEST_PREFIX_MAX_LENGTH } from '@/lib/input-rules';
import { formatRequestNumber } from '@/lib/requests';

import { saveRequestPrefixAction } from './actions';

/** The number of the example request under the field, as on the sign-in pages. */
const EXAMPLE_NUMBER = 142;

/**
 * A prefix field with a save button. Under it, a request's number as it's
 * shown with the saved prefix.
 *
 * @param props - Form props.
 * @param props.prefix - The saved prefix.
 * @returns The form.
 */
export default function RequestPrefixForm({ prefix }: { prefix: string }) {
  const t = useTranslations('admin.staff.requestNumbers');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveRequestPrefixAction,
    null,
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <TextField
          label={t('label')}
          name="prefix"
          maxLength={REQUEST_PREFIX_MAX_LENGTH}
          defaultValue={prefix}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          description={t('example', { example: formatRequestNumber(prefix, EXAMPLE_NUMBER) })}
          className="max-w-40 uppercase"
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
