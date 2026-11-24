/**
 * @file A form that narrows a list to a range of days: "From" and "To" date
 * fields with an Apply button, submitted as query parameters like
 * `SearchForm`, and a Clear link once a date is set.
 */
'use client';

import Form from 'next/form';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useFormStatus } from 'react-dom';

import Button from './button';
import Spinner from './spinner';
import TextField from './text-field';

/**
 * Props for {@link DateRangeForm}.
 */
interface DateRangeFormProps {
  /** Name of the form, e.g. "Filter by date". */
  label: string;
  /** The current first day (`yyyy-mm-dd`), sent as `from`. */
  from?: string;
  /** The current last day (`yyyy-mm-dd`), sent as `to`. */
  to?: string;
  /** Other query parameters to keep, e.g. the search and the filter. */
  hiddenFields?: Record<string, string>;
  /** Where Clear goes: the same list without the dates. Shown once a date is set. */
  clearHref: string;
}

/**
 * The Apply button. While the results load it shows a spinner and is busy
 * (`aria-busy`, with the wait cursor), but stays enabled, so keyboard focus
 * stays on it.
 *
 * @returns The button.
 */
function ApplyButton() {
  const t = useTranslations('common');
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" aria-busy={pending || undefined}>
      {pending && <Spinner />}
      {t('actions.apply')}
    </Button>
  );
}

/**
 * Two labelled date fields and Apply, built on `next/form`: the dates go in
 * the `from` and `to` query parameters of the same page, which loads within
 * the app. Either may be left empty. Clear removes both.
 *
 * @returns The form.
 */
export default function DateRangeForm({
  label,
  from = '',
  to = '',
  hiddenFields = {},
  clearHref,
}: DateRangeFormProps) {
  const t = useTranslations('common');
  const id = useId();
  return (
    <Form action="" scroll={false} aria-label={label} className="flex flex-wrap items-end gap-2">
      {Object.entries(hiddenFields).map(([field, value]) => (
        <input key={field} type="hidden" name={field} value={value} />
      ))}
      <TextField
        id={`${id}-from`}
        label={t('dateRange.from')}
        name="from"
        type="date"
        defaultValue={from}
        className="w-40"
      />
      <TextField
        id={`${id}-to`}
        label={t('dateRange.to')}
        name="to"
        type="date"
        defaultValue={to}
        className="w-40"
      />
      <ApplyButton />
      {(from || to) && (
        <Button asChild variant="ghost">
          <Link href={clearHref} scroll={false}>
            {t('actions.clear')}
          </Link>
        </Button>
      )}
    </Form>
  );
}
