/**
 * @file Form to register a user account by email address.
 */
'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import EmailLanguageField from '@/components/language/email-language-field';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
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
 * @param props - Component props.
 * @param props.defaultLocale - Adiutor's default language, named in the Default option.
 * @returns The form.
 */
export default function RegisterUserForm({ defaultLocale }: { defaultLocale: Locale }) {
  const t = useTranslations('admin.addUser.form');
  const [result, formAction, pending, onSubmit] = useTransientActionState(registerUserAction, null);
  // A new form after "Add another", so the old result doesn't show again.
  const [attempt, setAttempt] = useState(0);
  const [showResult, setShowResult] = useState(true);

  if (showResult && result?.ok && result.data) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert tone={result.data.created ? 'success' : 'info'} focusOnShow>
          {result.message ?? null}
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/admin/users/${result.data.userId}`}>
              {t('openUser')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setShowResult(false);
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
    <form
      key={attempt}
      action={formAction}
      onSubmit={(event) => {
        setShowResult(true);
        onSubmit(event);
      }}
      className="flex flex-col gap-4"
    >
      {showResult && <ResultAlert result={result} errorsOnly />}
      <TextField
        label={t('email')}
        type="email"
        name="email"
        autoComplete="off"
        placeholder={t('placeholder')}
        description={t('description')}
        required
      />
      <EmailLanguageField purpose="account" defaultLocale={defaultLocale} />
      <div>
        <Button type="submit" loading={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
