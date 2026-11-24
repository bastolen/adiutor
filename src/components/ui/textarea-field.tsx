/**
 * @file Labelled multi-line text input with an optional description; the
 * multi-line sibling of `TextField`.
 *
 * A client component: its ids come from `useId`, and only the browser's one
 * React tree keeps them unique. Rendered on the server, they would start
 * again in every request, so a tab kept alive and the one loaded next could
 * share them (labels and card names would point at the wrong element).
 */
'use client';

import { type ComponentProps, useId } from 'react';

import cn from '@/lib/cn';

import { fieldControl } from './styles';

/**
 * Props for {@link TextAreaField}.
 */
type TextAreaFieldProps = ComponentProps<'textarea'> & {
  /** Visible label text. */
  label: string;
  /** Help text below the input, read out with it. */
  description?: string;
};

/**
 * A textarea with a visible label. The description is linked with
 * `aria-describedby`, so screen readers announce it with the field.
 *
 * @returns The labelled textarea.
 */
export default function TextAreaField({
  label,
  description = '',
  id,
  className = '',
  rows = 3,
  ...props
}: TextAreaFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={inputId}
        rows={rows}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(fieldControl, 'min-h-20 resize-y leading-6', className)}
        {...props}
      />
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
