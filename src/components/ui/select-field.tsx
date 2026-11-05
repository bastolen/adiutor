/**
 * @file Labelled select menu built on Radix Select.
 */
'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select } from 'radix-ui';
import { useId, useState } from 'react';

import cn from '@/lib/cn';

import { fieldControl } from './styles';

/** One option in a {@link SelectField}. */
export interface SelectOption {
  /** Submitted value. */
  value: string;
  /** Visible text. */
  label: string;
  /** Short explanation shown under the label in the list, e.g. what a role can do. Read out after the label. */
  description?: string;
}

/**
 * Props for {@link SelectField}.
 */
interface SelectFieldProps {
  /** Visible label text. */
  label: string;
  /** The choices. */
  options: readonly SelectOption[];
  /** Field name, for forms (Radix submits it through a hidden native select). */
  name?: string;
  /** Initial value (uncontrolled). */
  defaultValue?: string;
  /** Current value (controlled). */
  value?: string;
  /** Text shown while nothing is chosen (when the value is `''`). */
  placeholder?: string;
  /** Called with the new value once a choice is committed. */
  onValueChange?: (value: string) => void;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
  /** Disable the field. */
  disabled?: boolean;
  /**
   * Mark it busy, e.g. while the chosen value saves: it can't be opened, but
   * keeps focus (unlike `disabled`, which would drop it), with `aria-busy`,
   * `aria-disabled` and the wait cursor.
   */
  busy?: boolean;
  /** Extra classes for the trigger. */
  className?: string;
}

/**
 * A select with a visible label, following the WAI-ARIA listbox pattern:
 * the choice only changes when an option is picked (Enter, Space or click);
 * arrow keys and typing just move through the list, so nothing is saved by
 * accident. Option descriptions are shown in the list and are part of the
 * option's name (label first); the closed select shows only the label.
 * While `busy`, it stays focusable but doesn't open.
 *
 * @param props - Select props.
 * @param props.label - Label text.
 * @param props.options - The choices.
 * @param props.name - Field name.
 * @param props.defaultValue - Initial value.
 * @param props.value - Current value.
 * @param props.placeholder - Text shown while nothing is chosen.
 * @param props.onValueChange - Called when a choice is committed.
 * @param props.hideLabel - Hide the label visually.
 * @param props.disabled - Disabled state.
 * @param props.busy - Busy state: focusable, but doesn't open.
 * @param props.className - Extra trigger classes.
 * @returns The labelled select.
 */
export default function SelectField({
  label,
  options,
  name = undefined,
  defaultValue = undefined,
  value = undefined,
  placeholder = undefined,
  onValueChange = undefined,
  hideLabel = false,
  disabled = false,
  busy = false,
  className = '',
}: SelectFieldProps) {
  const id = useId();
  // Kept here, so it can refuse to open while busy.
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-sm font-medium text-foreground'}>
        {label}
      </label>
      <Select.Root
        name={name}
        defaultValue={defaultValue}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        open={open}
        onOpenChange={(next) => setOpen(next && !busy)}
      >
        <Select.Trigger
          id={id}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          className={cn(
            fieldControl,
            'flex h-10 items-center justify-between gap-2 text-left data-placeholder:text-muted-foreground',
            className,
          )}
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon>
            <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-(--radix-select-content-available-height) max-w-80 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-border bg-raised p-1 text-foreground shadow-lg"
          >
            <Select.Viewport>
              {options.map((option) => {
                const optionLabelId = `${id}-${option.value}-label`;
                const optionDescriptionId = `${id}-${option.value}-description`;
                return (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    // With a description, the option's name is the label followed by the
                    // description, so it contains all of its visible text (WCAG 2.5.3).
                    aria-labelledby={
                      option.description ? `${optionLabelId} ${optionDescriptionId}` : undefined
                    }
                    className="relative flex min-h-9 flex-col justify-center rounded-md py-2 pr-3 pl-8 text-sm outline-none select-none data-disabled:opacity-50 data-highlighted:bg-raised-muted"
                  >
                    <Select.ItemIndicator className="absolute top-2.5 left-2 inline-flex">
                      <Check aria-hidden="true" className="size-4 text-highlight" />
                    </Select.ItemIndicator>
                    <span id={optionLabelId}>
                      <Select.ItemText>{option.label}</Select.ItemText>
                    </span>
                    {/* A space between label and description in the text (not visible in the column layout). */}
                    {option.description && ' '}
                    {option.description && (
                      <span id={optionDescriptionId} className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </Select.Item>
                );
              })}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
