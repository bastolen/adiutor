/**
 * @file Form to change a company's name and URL name.
 */
'use client';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { NAME_MAX_LENGTH, SLUG_MAX_LENGTH } from '@/lib/input-rules';

import { updateCompanyAction } from './actions';

/**
 * Props for {@link CompanyForm}.
 */
interface CompanyFormProps {
  /** The company. */
  companyId: string;
  /** Current name. */
  name: string;
  /** Current URL name. */
  slug: string;
}

/**
 * Name and URL name fields with a save button.
 *
 * @param props - Form props.
 * @param props.companyId - The company.
 * @param props.name - Current name.
 * @param props.slug - Current URL name.
 * @returns The form.
 */
export default function CompanyForm({ companyId, name, slug }: CompanyFormProps) {
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    updateCompanyAction,
    null,
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <ResultAlert result={result} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          maxLength={NAME_MAX_LENGTH}
          defaultValue={name}
          autoComplete="organization"
          required
        />
        <TextField
          label="URL name"
          name="slug"
          maxLength={SLUG_MAX_LENGTH}
          defaultValue={slug}
          description={`Lowercase letters, numbers and dashes. The company's pages are at /companies/${slug}; changing it changes that address, and links with the old one stop working.`}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      <div>
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
