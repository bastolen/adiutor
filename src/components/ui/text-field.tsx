/**
 * @file Labelled text input with an optional description. Forms report
 * errors with `Alert` / `ResultAlert`, not per field.
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
 * Props for {@link TextField}.
 */
type TextFieldProps = ComponentProps<'input'> & {
  /** Visible label text. */
  label: string;
  /** Help text below the input, read out with it. */
  description?: string;
};

/**
 * A text input with a visible label. The description is linked with
 * `aria-describedby`, so screen readers announce it with the field.
 *
 * @param props - Input props.
 * @param props.label - Visible label text.
 * @param props.description - Help text.
 * @param props.id - Input ID. Generated when omitted.
 * @param props.className - Extra classes for the input.
 * @returns The labelled input.
 */
export default function TextField({
  label,
  description = '',
  id,
  className = '',
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(fieldControl, 'h-10', className)}
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
