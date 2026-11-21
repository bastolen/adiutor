/**
 * @file Labelled checkbox with optional help text.
 */
import { type ComponentProps, type ReactNode, useId } from 'react';

import cn from '@/lib/cn';

import { focusRing } from './styles';

/**
 * Props for {@link CheckboxField}.
 */
type CheckboxFieldProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** Visible label: text, or text with an icon (a language's flag and its name). */
  label: ReactNode;
  /** Help text below the label, read out with the checkbox. */
  description?: string;
};

/**
 * A native checkbox with its label to the right. The whole label is
 * clickable, and the description is linked with `aria-describedby`. The box
 * is 20px, level with the label's first line, and the label reaches 2px above
 * and below its text, so box and label together are at least 24px to tap
 * (WCAG 2.5.8) without moving anything.
 *
 * @param props - Checkbox props.
 * @param props.label - Label text.
 * @param props.description - Help text.
 * @param props.id - Checkbox ID. Generated when omitted.
 * @param props.className - Extra classes for the checkbox.
 * @returns The labelled checkbox.
 */
export default function CheckboxField({
  label,
  description = '',
  id,
  className = '',
  ...props
}: CheckboxFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;

  return (
    <div className="flex items-start gap-3">
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'mt-px size-5 shrink-0 cursor-pointer rounded-sm border-border-strong accent-primary disabled:cursor-not-allowed',
          focusRing,
          className,
        )}
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={inputId} className="-my-0.5 py-0.5 text-sm font-medium text-foreground">
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
