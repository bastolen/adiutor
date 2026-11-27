/**
 * @file The Attaching files form on Settings' Integrations tab: the
 * "People can attach files" switch. Its text comes from
 * `admin.settings.attachments.attaching` (through `ClientMessages`).
 */
'use client';

import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import CheckboxField from '@/components/ui/checkbox-field';
import ResultAlert from '@/components/ui/result-alert';
import { useSetByEnvironment } from '@/components/ui/set-by-environment';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState } from '@/components/ui/use-transient-state';

import { saveAttachingAction } from './actions';

/**
 * A checkbox with a save button. Without a storage it can't be turned on
 * and says to choose one first; while the server's environment turned
 * attachments off, it's off, can't be changed and says why. A box that
 * can't be changed has no button (it could only be refused). The box keeps what was saved after a
 * save (`resetOnSuccess: false`), rather than jumping back to the value the
 * page was loaded with.
 *
 * @param props - Form props.
 * @param props.on - Whether people can attach files now.
 * @param props.storageChosen - Whether a storage is chosen, which turning it on needs.
 * @param props.offByEnvironment - Whether the server's environment turned attachments off.
 */
export default function AttachingForm({
  on,
  storageChosen,
  offByEnvironment,
}: {
  on: boolean;
  storageChosen: boolean;
  offByEnvironment: boolean;
}) {
  const t = useTranslations('admin.settings.attachments.attaching');
  const setByEnvironment = useSetByEnvironment();
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveAttachingAction,
    null,
    { resetOnSuccess: false },
  );
  // Turning it off stays possible without a storage, so a switch left on can always go off.
  const locked = offByEnvironment || (!storageChosen && !on);
  let description: string | undefined;
  if (offByEnvironment) {
    description = setByEnvironment('ATTACHMENTS_STORAGE');
  } else if (!storageChosen) {
    description = t('storageFirst');
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <CheckboxField
          label={t('label')}
          name="enabled"
          defaultChecked={on && !offByEnvironment}
          description={description}
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
