/**
 * @file Form to add a company and invite its first admin. Its text comes from
 * `admin.addCompany.form` and `people.confirmBeforeGrant`, so the page passes
 * `admin` and `people` through `ClientMessages`.
 */
'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ConfirmFirstNote } from '@/components/auth/recent-confirmation';
import EmailLanguageField from '@/components/language/email-language-field';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientState, useTransientActionState } from '@/components/ui/use-transient-state';
import type { Locale } from '@/lib/i18n/locales';
import { NAME_MAX_LENGTH, SLUG_MAX_LENGTH, slugify } from '@/lib/input-rules';

import useConfirmBeforeGrant from '../../../_people/use-confirm-before-grant';
import registerCompanyAction from './actions';

/**
 * Name, URL name (suggested from the name until edited) and admin email.
 * After registering, links to the new company. Its first Admin gets the
 * company's Admin role, which needs a recent confirmation: without one, a
 * note with a link to confirm shows at the top, before anything is typed,
 * and there's no submit button. The Email language field starts on Default:
 * the invitation goes out in Adiutor's default language.
 *
 * @param props - Component props.
 * @param props.defaultLocale - Adiutor's default language, named in the Default option.
 * @returns The form.
 */
export default function RegisterCompanyForm({ defaultLocale }: { defaultLocale: Locale }) {
  const t = useTranslations('admin.addCompany.form');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const tPeople = useTranslations('people');
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    registerCompanyAction,
    null,
  );
  const [name, setName] = useTransientState('');
  const [slug, setSlug] = useTransientState('');
  const [slugEdited, setSlugEdited] = useTransientState(false);
  // A new company starts with no members, so its first Admin is always a new one.
  const confirmFirst = useConfirmBeforeGrant('new', 'admin');

  if (result?.ok && result.data) {
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert tone="success" focusOnShow>
          {result.message ?? null}
        </Alert>
        <Button asChild>
          <Link href={`/companies/${result.data.slug}/members`}>
            {t('open')}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        {confirmFirst && <ConfirmFirstNote>{tPeople('confirmBeforeGrant')}</ConfirmFirstNote>}
        <ResultAlert result={result} errorsOnly />
        <TextField
          label={t('nameLabel')}
          name="name"
          maxLength={NAME_MAX_LENGTH}
          required
          autoComplete="off"
          placeholder={t('namePlaceholder')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) {
              setSlug(slugify(event.target.value));
            }
          }}
          disabled={changesOff}
        />
        <TextField
          label={t('slugLabel')}
          name="slug"
          maxLength={SLUG_MAX_LENGTH}
          required
          autoComplete="off"
          spellCheck={false}
          description={t('slugDescription', { slug: slug || 'adiutor' })}
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
            setSlugEdited(true);
          }}
          disabled={changesOff}
        />
        <TextField
          label={t('emailLabel')}
          type="email"
          name="adminEmail"
          autoComplete="off"
          placeholder={t('emailPlaceholder')}
          description={t('emailDescription')}
          required
          disabled={changesOff}
        />
        <EmailLanguageField
          purpose="invitation"
          defaultLocale={defaultLocale}
          disabled={changesOff}
        />
        {!confirmFirst && (
          <div>
            <Button type="submit" loading={pending} disabled={changesOff}>
              {t('submit')}
            </Button>
          </div>
        )}
      </ChangesFieldset>
    </form>
  );
}
