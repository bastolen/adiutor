/**
 * @file Labelled multi-line text input with an optional description; the
 * multi-line sibling of `TextField`.
 */
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
 * @param props - Textarea props.
 * @param props.label - Visible label text.
 * @param props.description - Help text.
 * @param props.id - Textarea ID. Generated when omitted.
 * @param props.className - Extra classes for the textarea.
 * @param props.rows - Visible lines. Defaults to 3.
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
