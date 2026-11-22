/**
 * @file What the two kinds of {@link SelectField} share: the option type,
 * how an option's label is drawn, and the classes of the closed field, the
 * options and the group headings, so a short select and a searchable one
 * look and read the same.
 */
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

import { fieldControl, highlightedItem } from './styles';

/** One option in a {@link SelectField}. */
export interface SelectOption {
  /** Submitted value. */
  value: string;
  /** Visible text. A searchable select finds the option by it. */
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
  /**
   * The heading the option is listed under, e.g. a time zone's region.
   * Options that follow each other with the same group are listed together
   * under it; a searchable select also finds every option of a group by its
   * heading.
   */
  group?: string;
}

/**
 * The closed field: a select's trigger, the button that opens its list. The
 * placeholder (`data-placeholder`) is muted.
 */
export const selectTrigger = cn(
  fieldControl,
  'flex h-10 items-center justify-between gap-2 text-left data-placeholder:text-muted-foreground',
);

/**
 * One option in the list: room on the left for the check of the chosen one,
 * the description (if any) under the label, and the fill and outline of the
 * option the keyboard or pointer is on (`highlightedItem`).
 */
export const optionItem = cn(
  'relative flex min-h-9 flex-col justify-center rounded-md py-2 pr-3 pl-8 text-sm select-none data-disabled:opacity-50',
  highlightedItem,
);

/** Where the check of the chosen option sits, at the start of its first line. */
export const optionCheck = 'absolute top-2.5 left-2 inline-flex';

/** A group's heading in the list: small, muted text above its options. */
export const groupHeading = 'px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground';

/**
 * An option's label as the list and the closed select show it: its icon
 * first, if any, and the label marked with its language when it has one.
 *
 * @param props - Component props.
 * @param props.option - The option.
 * @returns The label.
 */
export function OptionLabel({ option }: { option: SelectOption }) {
  const label = option.lang ? <span lang={option.lang}>{option.label}</span> : option.label;
  if (!option.icon) {
    return label;
  }
  return (
    <span className="inline-flex items-center gap-2">
      {option.icon}
      {label}
    </span>
  );
}
