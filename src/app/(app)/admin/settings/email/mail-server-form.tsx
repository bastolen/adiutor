/**
 * @file The Mail server card's form, while Settings chooses the mail server:
 * its server, security, login and sender, tried and saved together. Its
 * text comes from `admin.settings.email.server`.
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
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import { useSetByEnvironment } from '@/components/ui/set-by-environment';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import {
  SMTP_FIELD_MAX_LENGTH,
  SMTP_SECURITIES,
  type SmtpSecurity,
  type SmtpView,
} from '@/lib/smtp';

import saveMailServerAction from './actions';

/** What every text field of the form shares: not the user's own data, and never spell-checked. */
const TEXT = {
  autoComplete: 'off',
  spellCheck: false,
  maxLength: SMTP_FIELD_MAX_LENGTH,
} as const;

/**
 * The mail server's form, starting from the saved one. The password is never
 * shown: a saved one is kept while its field is left empty and the server,
 * port and username stay the same. While `EMAIL_FROM` chooses the sender,
 * its field is locked and says why (and isn't sent). Saving tries the mail
 * server first (a test email to the staff Admin saving it) and needs a
 * recent confirmation: until there is one, a note with a link to confirm
 * stands where the button would be, so nothing typed is lost.
 *
 * The form isn't cleared after a save (`resetOnSuccess: false`): it shows
 * what was saved, and only the password is emptied, which is never shown
 * again. The security chosen stays, like what's typed in the other fields,
 * also on the way back from confirming: saving always passes through that
 * page first, so a reset there would undo the choice before it's saved.
 *
 * @param props - Form props.
 * @param props.current - The saved mail server, without its password, or `null`.
 * @param props.environmentSender - The sender `EMAIL_FROM` chooses, or `null`.
 * @param props.production - Whether Adiutor runs in production, where emails fail without a mail server.
 */
export default function MailServerForm({
  current,
  environmentSender,
  production,
}: {
  current: SmtpView | null;
  environmentSender: string | null;
  production: boolean;
}) {
  const t = useTranslations('admin.settings.email.server');
  const setByEnvironment = useSetByEnvironment();
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const { mustConfirm } = useRecentConfirmation();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveMailServerAction,
    null,
    { resetOnSuccess: false },
  );
  const [security, setSecurity] = useState<SmtpSecurity>(current?.security ?? 'tls');
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (result?.ok) {
      // Saved: the password typed goes, as a saved one is never shown.
      form.current?.querySelectorAll<HTMLInputElement>('[data-secret]').forEach((field) => {
        // eslint-disable-next-line no-param-reassign -- emptying the field is the point
        field.value = '';
      });
    }
  }, [result]);

  return (
    <form ref={form} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <ReturnToField />
        {current === null &&
          (production ? (
            <Alert tone="info">{t('noneWarning')}</Alert>
          ) : (
            <p className="text-sm text-muted-foreground">{t('none')}</p>
          ))}
        <TextField
          {...TEXT}
          label={t('host')}
          name="host"
          defaultValue={current?.host}
          description={t('hostHint')}
          required
        />
        <SelectField
          label={t('security')}
          name="security"
          value={security}
          onValueChange={(value) => setSecurity(value as SmtpSecurity)}
          options={SMTP_SECURITIES.map((option) => ({
            value: option,
            label: t(`securities.${option}`),
            description: t(`securityHints.${option}`),
          }))}
          disabled={changesOff}
        />
        <TextField
          label={t('port')}
          name="port"
          type="number"
          inputMode="numeric"
          min={1}
          max={65535}
          autoComplete="off"
          defaultValue={current?.port}
          description={t('portHint')}
          className="max-w-32"
        />
        <TextField
          {...TEXT}
          label={t('username')}
          name="username"
          defaultValue={current?.username ?? undefined}
          description={t('usernameHint')}
        />
        <TextField
          data-secret
          label={t('password')}
          name="password"
          type="password"
          autoComplete="new-password"
          maxLength={SMTP_FIELD_MAX_LENGTH}
          description={current?.hasPassword ? t('passwordSaved') : undefined}
        />
        {environmentSender === null ? (
          <>
            <TextField
              {...TEXT}
              label={t('fromName')}
              name="fromName"
              defaultValue={current?.from.name ?? undefined}
              description={t('fromNameHint')}
            />
            <TextField
              {...TEXT}
              label={t('fromAddress')}
              name="fromAddress"
              type="email"
              defaultValue={current?.from.address}
              description={t('fromAddressHint')}
              required
            />
          </>
        ) : (
          <TextField
            label={t('sender')}
            name="sender"
            defaultValue={environmentSender}
            description={setByEnvironment('EMAIL_FROM')}
            disabled
          />
        )}
        <p className="text-sm text-muted-foreground">{t('whoIsTold')}</p>
        {mustConfirm ? (
          <ConfirmFirstNote>{t('confirmFirst')}</ConfirmFirstNote>
        ) : (
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
