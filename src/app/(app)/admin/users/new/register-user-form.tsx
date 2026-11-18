/**
 * @file Form to register a user account by email address.
 */
'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import EmailLanguageField from '@/components/language/email-language-field';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import type { Locale } from '@/lib/i18n/locales';

import registerUserAction from './actions';

/**
 * An email field with a submit button. Afterwards it says what happened, with
 * a link to the user (new or existing) and a way to add another. Its text
 * comes from the `admin.addUser` messages: the page passes them with
 * `ClientMessages` (namespace `admin`). The Email language field starts on
 * Default, so the new account follows Adiutor's default language.
 *
 * "Add another" dismisses the result it was shown with, for good: the form
 * that comes back is a new, empty one with focus on its email field (the
 * button that had focus is gone), and it stays, with what's typed in it,
 * while the next address is sent and when that one is refused. Only a new
 * result is shown.
 *
 * @param props - Component props.
 * @param props.defaultLocale - Adiutor's default language, named in the Default option.
 * @returns The form.
 */
export default function RegisterUserForm({ defaultLocale }: { defaultLocale: Locale }) {
  const t = useTranslations('admin.addUser.form');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(registerUserAction, null);
  // The result "Add another" was pressed on. The hook keeps returning it until the next one
  // arrives, so it's left out by what it is, not by a flag a new submit would have to flip.
  const [dismissed, setDismissed] = useState(result);
  // A new form after "Add another", so it starts empty.
  const [attempt, setAttempt] = useState(0);
  const emailField = useRef<HTMLInputElement>(null);
  // Set by "Add another": the new form's email field takes focus once it's there.
  const focusEmailField = useRef(false);
  const shown = result === dismissed ? null : result;

  useEffect(() => {
    if (focusEmailField.current) {
      focusEmailField.current = false;
      emailField.current?.focus();
    }
  }, [attempt]);

  if (shown?.ok && shown.data) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert tone={shown.data.created ? 'success' : 'info'} focusOnShow>
          {shown.message ?? null}
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/admin/users/${shown.data.userId}`}>
              {t('openUser')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDismissed(result);
              focusEmailField.current = true;
              setAttempt((value) => value + 1);
            }}
          >
            {t('addAnother')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form key={attempt} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={shown} errorsOnly />
        <TextField
          ref={emailField}
          label={t('email')}
          type="email"
          name="email"
          autoComplete="off"
          placeholder={t('placeholder')}
          description={t('description')}
          required
          disabled={changesOff}
        />
        <EmailLanguageField purpose="account" defaultLocale={defaultLocale} disabled={changesOff} />
        <div>
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('submit')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
