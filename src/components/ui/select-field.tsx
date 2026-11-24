/**
 * @file Labelled select menu: a Radix Select for a short list, and a
 * searchable one (`SearchableSelect`) for a field with more options than
 * {@link SEARCH_THRESHOLD}.
 */
'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select } from 'radix-ui';
import { useId, useState } from 'react';

import cn from '@/lib/cn';

import SearchableSelect from './searchable-select';
import { groupOptions } from './select-option-list';
import {
  groupHeading,
  optionCheck,
  optionItem,
  OptionLabel,
  type SelectOption,
  selectTrigger,
} from './select-options';
import { SCREEN_GUTTER } from './styles';

export type { SelectOption } from './select-options';

/**
 * How many options a select lists before it becomes searchable: a field with
 * more options than this gets a search field above its list.
 */
export const SEARCH_THRESHOLD = 10;

/**
 * Props for {@link SelectField}.
 */
interface SelectFieldProps {
  /** Visible label text. */
  label: string;
  /** The choices. */
  options: readonly SelectOption[];
  /** Field name, for forms (submitted through a hidden field). */
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

/** Props for {@link ShortSelect}: the field's, with the IDs the label and help text use. */
interface ShortSelectProps extends Omit<SelectFieldProps, 'label' | 'hideLabel' | 'description'> {
  /** The trigger's ID, which the visible label points at. */
  id: string;
  /** The label's ID, which names the open list. */
  labelId: string;
  /** The help text's ID, if the field has one. */
  descriptionId?: string;
}

/**
 * The short select: a Radix Select. Options with a `group` are listed under
 * its heading. The open list is named by the field's label
 * (`aria-labelledby`), as the searchable list is, so a screen reader says
 * which list it is in.
 *
 * @returns The trigger and, while open, its list.
 */
function ShortSelect({
  id,
  labelId,
  descriptionId = undefined,
  options,
  name = undefined,
  defaultValue = undefined,
  value = undefined,
  placeholder = undefined,
  onValueChange = undefined,
  disabled = false,
  busy = false,
  className = '',
}: ShortSelectProps) {
  // Kept here, so it can refuse to open while busy.
  const [open, setOpen] = useState(false);

  /**
   * One option in the list.
   *
   * @param option - The option.
   * @returns Its item.
   */
  const renderItem = (option: SelectOption) => {
    const optionLabelId = `${id}-${option.value}-label`;
    const optionDescriptionId = `${id}-${option.value}-description`;
    return (
      <Select.Item
        key={option.value}
        value={option.value}
        textValue={option.label}
        // With a description, the option's name is the label followed by the
        // description, so it contains all of its visible text (WCAG 2.5.3).
        aria-labelledby={option.description ? `${optionLabelId} ${optionDescriptionId}` : undefined}
        className={optionItem}
      >
        <Select.ItemIndicator className={optionCheck}>
          <Check aria-hidden="true" className="size-4 text-highlight" />
        </Select.ItemIndicator>
        <span id={optionLabelId}>
          <Select.ItemText>
            <OptionLabel option={option} />
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
  };

  return (
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
        aria-describedby={descriptionId}
        className={cn(selectTrigger, className)}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          aria-labelledby={labelId}
          position="popper"
          sideOffset={4}
          collisionPadding={SCREEN_GUTTER}
          className="z-50 max-h-(--radix-select-content-available-height) max-w-80 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-border bg-raised p-1 text-foreground shadow-lg"
        >
          <Select.Viewport>
            {groupOptions(options).map((group) =>
              group.heading === undefined ? (
                group.options.map(renderItem)
              ) : (
                <Select.Group key={`${group.heading}-${group.options[0]?.value ?? ''}`}>
                  <Select.Label className={groupHeading}>{group.heading}</Select.Label>
                  {group.options.map(renderItem)}
                </Select.Group>
              ),
            )}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

/**
 * A select with a visible label. A short list (up to {@link SEARCH_THRESHOLD}
 * options) is a
 * Radix Select following the WAI-ARIA listbox pattern: the choice only
 * changes when an option is picked (Enter, Space or click); arrow keys and
 * typing just move through the list, so nothing is saved by accident. A
 * longer list can be searched (`SearchableSelect`): the list opens with a
 * search field above it that shows only the options whose label, or group
 * heading, contains what's typed; there too, only Enter or a click picks.
 *
 * In both, the open list is named by the field's label, and option
 * descriptions are shown in the list and are part of the option's name
 * (label first); the closed select shows only the label. A
 * label in another language than the page's carries its `lang`, in the list
 * and in the closed select. Options with a `group` are listed under its
 * heading. The option the keyboard or pointer is on is filled and outlined
 * (`highlightedItem`). While `busy`, it stays focusable but doesn't open.
 * The value is submitted under `name`, also before JavaScript has loaded.
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
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const field = {
    id,
    descriptionId,
    options,
    name,
    defaultValue,
    value,
    placeholder,
    onValueChange,
    disabled,
    busy,
    className,
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label
        id={labelId}
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'text-sm font-medium text-foreground'}
      >
        {label}
      </label>
      {options.length > SEARCH_THRESHOLD ? (
        <SearchableSelect labelId={labelId} {...field} />
      ) : (
        <ShortSelect labelId={labelId} {...field} />
      )}
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
