/**
 * @file The Storage form on Settings' Connections tab: a select of
 * the drivers, then the chosen driver's fields, and "Test and save". Its
 * text comes from `admin.settings.attachments.storage` (through
 * `ClientMessages`).
 */
'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import {
  ConfirmFirstNote,
  ReturnToField,
  useRecentConfirmation,
} from '@/components/auth/recent-confirmation';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import CheckboxField from '@/components/ui/checkbox-field';
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import TextAreaField from '@/components/ui/textarea-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import {
  DEFAULT_SFTP_PORT,
  PRIVATE_KEY_MAX_LENGTH,
  STORAGE_DRIVERS,
  STORAGE_FIELD_MAX_LENGTH,
  type StorageDriver,
  type StorageView,
} from '@/lib/storage';

import { saveStorageAction } from './actions';

/** What every text field of the form shares: not the user's own data, and never spell-checked. */
const TEXT = {
  autoComplete: 'off',
  spellCheck: false,
  maxLength: STORAGE_FIELD_MAX_LENGTH,
} as const;

/**
 * What every secret field shares: hidden as it's typed, never filled with
 * the user's own password, and marked so a save can empty it.
 */
const SECRET = {
  type: 'password',
  autoComplete: 'new-password',
  maxLength: STORAGE_FIELD_MAX_LENGTH,
  'data-secret': true,
} as const;

/**
 * The fields of a folder on this server.
 *
 * @param props - Field props.
 * @param props.saved - The saved storage, when it's a folder too.
 */
function LocalFields({ saved }: { saved: Extract<StorageView, { driver: 'local' }> | null }) {
  const t = useTranslations('admin.settings.attachments.storage');
  return (
    <TextField
      {...TEXT}
      label={t('dir')}
      name="dir"
      defaultValue={saved?.dir}
      placeholder={t('dirPlaceholder')}
      description={t('localDirHint')}
      required
    />
  );
}

/**
 * The fields of an S3-compatible bucket. The secret key starts empty: a
 * saved one is never sent to the browser.
 *
 * @param props - Field props.
 * @param props.saved - The saved storage, when it's a bucket too.
 */
function BucketFields({ saved }: { saved: Extract<StorageView, { driver: 's3' }> | null }) {
  const t = useTranslations('admin.settings.attachments.storage');
  return (
    <>
      <TextField
        {...TEXT}
        label={t('endpoint')}
        name="endpoint"
        type="url"
        defaultValue={saved?.endpoint}
        placeholder={t('endpointPlaceholder')}
        description={t('endpointHint')}
        required
      />
      <TextField
        {...TEXT}
        label={t('region')}
        name="region"
        defaultValue={saved?.region}
        description={t('regionHint')}
      />
      <TextField
        {...TEXT}
        label={t('bucket')}
        name="bucket"
        defaultValue={saved?.bucket}
        required
      />
      <TextField
        {...TEXT}
        label={t('accessKeyId')}
        name="accessKeyId"
        defaultValue={saved?.accessKeyId}
        required
      />
      <TextField
        {...SECRET}
        label={t('secretAccessKey')}
        name="secretAccessKey"
        description={saved ? t('s3SecretSaved') : undefined}
        required={!saved}
      />
      <CheckboxField
        label={t('forcePathStyle')}
        name="forcePathStyle"
        defaultChecked={saved?.forcePathStyle}
        description={t('forcePathStyleHint')}
      />
    </>
  );
}

/**
 * The fields of a folder over SFTP. The password and the private key start
 * empty: a saved one is never sent to the browser.
 *
 * @param props - Field props.
 * @param props.saved - The saved storage, when it's an SFTP server too.
 */
function SftpFields({ saved }: { saved: Extract<StorageView, { driver: 'sftp' }> | null }) {
  const t = useTranslations('admin.settings.attachments.storage');
  let savedSecret: string | undefined;
  if (saved) {
    savedSecret =
      saved.signsInWith === 'key' ? t('sftpSecretSaved.key') : t('sftpSecretSaved.password');
  }
  return (
    <>
      <TextField {...TEXT} label={t('host')} name="host" defaultValue={saved?.host} required />
      <TextField
        label={t('port')}
        name="port"
        type="number"
        inputMode="numeric"
        min={1}
        max={65535}
        autoComplete="off"
        defaultValue={saved?.port ?? DEFAULT_SFTP_PORT}
        className="max-w-32"
        required
      />
      <TextField
        {...TEXT}
        label={t('username')}
        name="username"
        defaultValue={saved?.username}
        required
      />
      <TextField {...SECRET} label={t('password')} name="password" description={savedSecret} />
      <TextAreaField
        data-secret
        label={t('privateKey')}
        name="privateKey"
        rows={4}
        autoComplete="off"
        spellCheck={false}
        maxLength={PRIVATE_KEY_MAX_LENGTH}
        description={t('privateKeyHint')}
        className="font-mono"
      />
      <TextField
        {...TEXT}
        label={t('hostKey')}
        name="hostKey"
        defaultValue={saved?.hostKey}
        placeholder={t('hostKeyPlaceholder')}
        description={t('hostKeyHint')}
        className="font-mono"
        required
      />
      <TextField
        {...TEXT}
        label={t('dir')}
        name="dir"
        defaultValue={saved?.dir}
        description={t('sftpDirHint')}
        required
      />
    </>
  );
}

/**
 * The storage's form: the drivers to choose from (a folder on this server
 * only off Vercel), then the chosen one's fields, starting from the saved
 * storage when it's the same driver. Saving tries the storage first, and
 * needs a recent confirmation: until there is one, a note with a link to
 * confirm stands where the button would be, so nothing typed is lost.
 *
 * The form isn't cleared after a save (`resetOnSuccess: false`): it shows
 * what was saved, and only its secrets are emptied, which are never shown
 * again. The driver chosen stays, like what's typed in its fields, also on
 * the way back from confirming: saving always passes through that page
 * first, so a reset there would undo the choice before it's saved.
 *
 * @param props - Form props.
 * @param props.current - The saved storage, without its secrets, or `null`.
 * @param props.vercel - Whether Adiutor runs on Vercel.
 * @param props.setUp - Whether the saved storage is set up as Adiutor's; `null` when that
 *   couldn't be told, or there's none. A folder that isn't says so: testing and saving it again
 *   sets it up.
 */
export default function StorageForm({
  current,
  vercel,
  setUp = null,
}: {
  current: StorageView | null;
  vercel: boolean;
  setUp?: boolean | null;
}) {
  const t = useTranslations('admin.settings.attachments.storage');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const { mustConfirm } = useRecentConfirmation();
  const [result, formAction, pending, onSubmit] = useTransientActionState(saveStorageAction, null, {
    resetOnSuccess: false,
  });
  const [driver, setDriver] = useState<StorageDriver | ''>(current?.driver ?? '');
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (result?.ok) {
      // Saved: the secrets typed go, as a saved one is never shown.
      form.current
        ?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-secret]')
        .forEach((field) => {
          // eslint-disable-next-line no-param-reassign -- emptying the field is the point
          field.value = '';
        });
    }
  }, [result]);

  const labels: Record<StorageDriver, string> = {
    local: t('drivers.local'),
    s3: t('drivers.s3'),
    sftp: t('drivers.sftp'),
  };
  const hints: Record<StorageDriver, string> = {
    local: t('driverHints.local'),
    s3: t('driverHints.s3'),
    sftp: t('driverHints.sftp'),
  };
  const drivers = STORAGE_DRIVERS.filter((option) => !(vercel && option === 'local'));

  return (
    <form ref={form} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <ReturnToField />
        {current === null && <p className="text-sm text-muted-foreground">{t('none')}</p>}
        {current !== null && setUp === false && <Alert tone="info">{t('notSetUpSettings')}</Alert>}
        <SelectField
          label={t('driver')}
          name="driver"
          value={driver}
          onValueChange={(value) => setDriver(value as StorageDriver)}
          placeholder={t('choose')}
          options={drivers.map((option) => ({
            value: option,
            label: labels[option],
            description: hints[option],
          }))}
          disabled={changesOff}
        />
        {driver === 'local' && <LocalFields saved={current?.driver === 'local' ? current : null} />}
        {driver === 's3' && <BucketFields saved={current?.driver === 's3' ? current : null} />}
        {driver === 'sftp' && <SftpFields saved={current?.driver === 'sftp' ? current : null} />}
        {mustConfirm ? (
          <ConfirmFirstNote>{t('confirmFirst')}</ConfirmFirstNote>
        ) : (
          <div>
            <Button type="submit" loading={pending} disabled={changesOff || driver === ''}>
              {t('save')}
            </Button>
          </div>
        )}
      </ChangesFieldset>
    </form>
  );
}
