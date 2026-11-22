/**
 * @file Labelled radio button with optional help text and something in
 * front of the label (a preview, such as an avatar), for a choice among a
 * few options in a fieldset.
 *
 * A client component: its ids come from `useId`, and only the browser's one
 * React tree keeps them unique. Rendered on the server, they would start
 * again in every request, so a tab kept alive and the one loaded next could
 * share them (labels and card names would point at the wrong element).
 */
'use client';

import { type ComponentProps, type ReactNode, useId } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/**
 * Props for {@link RadioField}.
 */
type RadioFieldProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** Visible label text. */
  label: string;
  /** Help text below the label, read out with the radio button. */
  description?: string;
  /** Something shown between the radio button and the label, e.g. a preview of the choice. */
  leading?: ReactNode;
};

/**
 * A native radio button with its label to the right, like `CheckboxField`.
 * Radio buttons with one `name` form one group: the arrow keys move between
 * them, and Tab enters and leaves the group as one stop. The whole label is
 * clickable, the description is linked with `aria-describedby`, and the
 * button is 20px, level with the label's first line, at least 24px to tap
 * with its label (WCAG 2.5.8). A disabled option's label is muted, not
 * faded, so it stays readable.
 *
 * @param props - Radio props.
 * @param props.label - Label text.
 * @param props.description - Help text.
 * @param props.leading - What stands before the label.
 * @param props.id - Radio button ID. Generated when omitted.
 * @param props.className - Extra classes for the radio button.
 * @param props.disabled - Whether the option can't be chosen.
 * @returns The labelled radio button.
 */
export default function RadioField({
  label,
  description = '',
  leading = null,
  id,
  className = '',
  disabled = false,
  ...props
}: RadioFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;

  return (
    <div className="flex items-center gap-3">
      <input
        id={inputId}
        type="radio"
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'size-5 shrink-0 cursor-pointer border-border-strong accent-primary disabled:cursor-not-allowed',
          focusRing,
          className,
        )}
        {...props}
      />
      {leading}
      <div className="flex min-w-0 flex-col gap-0.5">
        <label
          htmlFor={inputId}
          className={cn(
            '-my-0.5 py-0.5 text-sm font-medium wrap-anywhere',
            disabled
              ? 'cursor-not-allowed text-muted-foreground'
              : 'cursor-pointer text-foreground',
          )}
        >
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
