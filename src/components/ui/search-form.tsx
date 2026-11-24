/**
 * @file Search form for lists: a search field with a magnifier icon and a
 * Search button, submitted as a query parameter.
 */
'use client';

import { Search } from 'lucide-react';
import Form from 'next/form';
import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';

import cn from '@/lib/cn';

import Button from './button';
import Spinner from './spinner';
import { fieldControl } from './styles';

/**
 * Props for {@link SearchForm}.
 */
interface SearchFormProps {
  /** ID of the search field. */
  id: string;
  /** What's searched, e.g. "Search companies". Used as the field's label and the landmark's name. */
  label: string;
  /** Example text in the empty field, e.g. "Search by name". */
  placeholder: string;
  /** The current search text. */
  defaultValue?: string;
  /** Other query parameters to keep when searching, e.g. the current filter. */
  hiddenFields?: Record<string, string>;
}

/**
 * The Search button. While the results load it shows a spinner and is busy
 * (`aria-busy`, with the wait cursor), but stays enabled, so keyboard focus
 * stays on it; pressing it again just searches again. On phones it has a
 * little less padding, so the field keeps room for its placeholder.
 *
 * @returns The button.
 */
function SearchButton() {
  const t = useTranslations('common.actions');
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="secondary"
      aria-busy={pending || undefined}
      className="px-3 sm:px-4"
    >
      {pending && <Spinner />}
      {t('search')}
    </Button>
  );
}

/**
 * A search landmark (`role="search"`) with a labelled search field and a
 * Search button. Built on `next/form`: the text goes in the `q` query
 * parameter of the same page, which loads within the app (focus, the typed
 * text and the pages kept alive stay, and the page doesn't scroll). Without
 * JavaScript it's a normal GET request, so the results can be bookmarked
 * either way.
 *
 * @returns The form.
 */
export default function SearchForm({
  id,
  label,
  placeholder,
  defaultValue = '',
  hiddenFields = {},
}: SearchFormProps) {
  return (
    <Form
      action=""
      scroll={false}
      role="search"
      aria-label={label}
      className="flex max-w-md items-end gap-2"
    >
      {Object.entries(hiddenFields).map(([field, value]) => (
        <input key={field} type="hidden" name={field} value={value} />
      ))}
      <label htmlFor={id} className="relative flex-1">
        <span className="sr-only">{label}</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id={id}
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder={placeholder}
          autoComplete="off"
          className={cn(fieldControl, 'h-10 pl-9')}
        />
      </label>
      <SearchButton />
    </Form>
  );
}
