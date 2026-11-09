/**
 * @file Form to add a company and invite its first admin.
 */
'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { ConfirmFirstNote } from '@/components/auth/recent-confirmation';
import EmailLanguageField from '@/components/language/email-language-field';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientState, useTransientActionState } from '@/components/ui/use-transient-state';
import { NAME_MAX_LENGTH, SLUG_MAX_LENGTH, slugify } from '@/lib/input-rules';

import registerCompanyAction from './actions';
import useConfirmBeforeGrant, {
  CONFIRM_BEFORE_GRANT_NOTE,
} from '../../../_people/use-confirm-before-grant';

/**
 * Name, URL name (suggested from the name until edited) and admin email.
 * After registering, links to the new company. Its first Admin gets the
 * company's Admin role, which needs a recent confirmation: without one, a
 * note with a link to confirm shows at the top, before anything is typed,
 * and there's no submit button.
 *
 * @returns The form.
 */
export default function RegisterCompanyForm() {
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
            Open the company
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      {confirmFirst && <ConfirmFirstNote>{CONFIRM_BEFORE_GRANT_NOTE}</ConfirmFirstNote>}
      <ResultAlert result={result} errorsOnly />
      <TextField
        label="Company name"
        name="name"
        maxLength={NAME_MAX_LENGTH}
        required
        autoComplete="off"
        placeholder="Adiutor"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (!slugEdited) {
            setSlug(slugify(event.target.value));
          }
        }}
      />
      <TextField
        label="URL name"
        name="slug"
        maxLength={SLUG_MAX_LENGTH}
        required
        autoComplete="off"
        spellCheck={false}
        description={`Suggested from the name. Lowercase letters, numbers and dashes. Its pages will be at /companies/${slug || 'adiutor'}.`}
        value={slug}
        onChange={(event) => {
          setSlug(event.target.value);
          setSlugEdited(true);
        }}
      />
      <TextField
        label="Email of the company's admin"
        type="email"
        name="adminEmail"
        autoComplete="off"
        placeholder="admin@adiutor.dev"
        description="They'll get an invitation to join as the company's Admin."
        required
      />
      <EmailLanguageField purpose="invitation" />
      {!confirmFirst && (
        <div>
          <Button type="submit" loading={pending}>
            Add company
          </Button>
        </div>
      )}
    </form>
  );
}
