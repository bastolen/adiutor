/**
 * @file Labelled select menu built on Radix Select.
 */
'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select } from 'radix-ui';
import { type ReactNode, useId, useState } from 'react';

import cn from '@/lib/cn';

import { fieldControl, highlightedItem, SCREEN_GUTTER } from './styles';

/** One option in a {@link SelectField}. */
export interface SelectOption {
  /** Submitted value. */
  value: string;
  /** Visible text. */
  label: string;
  /** Short explanation shown under the label in the list, e.g. what a role can do. Read out after the label. */
  description?: string;
  /**
   * A small decorative picture before the label, in the list and in the closed
   * select, e.g. a language's flag. Hide it from screen readers (`aria-hidden`):
   * the label names the option.
   */
  icon?: ReactNode;
  /**
   * The language the label is written in (a BCP 47 tag such as `nl-NL`), when
   * it isn't the page's: a language named in itself, like "Nederlands". It's
   * set on the label in the list and in the closed select, so screen readers
   * say it in that language (WCAG 3.1.2).
   */
  lang?: string;
}

/**
 * An option's label, marked with its language when it has one.
 *
 * @param option - The option.
 * @returns The label.
 */
function optionLabel(option: SelectOption): ReactNode {
  return option.lang ? <span lang={option.lang}>{option.label}</span> : option.label;
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
  /** Help text under the field, linked to it for screen readers (`aria-describedby`). */
  description?: string;
  /** Extra classes for the trigger. */
  className?: string;
}

/**
 * A select with a visible label, following the WAI-ARIA listbox pattern:
 * the choice only changes when an option is picked (Enter, Space or click);
 * arrow keys and typing just move through the list, so nothing is saved by
 * accident. Option descriptions are shown in the list and are part of the
 * option's name (label first); the closed select shows only the label. A
 * label in another language than the page's carries its `lang`, in the list
 * and in the closed select. The option the keyboard or pointer is on is
 * filled and outlined (`highlightedItem`).
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
 * @param props.description - Help text under the field.
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
  description = '',
  className = '',
}: SelectFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
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
          aria-describedby={description ? descriptionId : undefined}
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
            collisionPadding={SCREEN_GUTTER}
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
                    textValue={option.label}
                    // With a description, the option's name is the label followed by the
                    // description, so it contains all of its visible text (WCAG 2.5.3).
                    aria-labelledby={
                      option.description ? `${optionLabelId} ${optionDescriptionId}` : undefined
                    }
                    className={cn(
                      'relative flex min-h-9 flex-col justify-center rounded-md py-2 pr-3 pl-8 text-sm select-none data-disabled:opacity-50',
                      highlightedItem,
                    )}
                  >
                    <Select.ItemIndicator className="absolute top-2.5 left-2 inline-flex">
                      <Check aria-hidden="true" className="size-4 text-highlight" />
                    </Select.ItemIndicator>
                    <span id={optionLabelId}>
                      <Select.ItemText>
                        {option.icon ? (
                          <span className="inline-flex items-center gap-2">
                            {option.icon}
                            {optionLabel(option)}
                          </span>
                        ) : (
                          optionLabel(option)
                        )}
                      </Select.ItemText>
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
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
