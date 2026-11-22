/**
 * @file What the two kinds of {@link SelectField} share: the option type,
 * how an option's label is drawn (with what matches a search marked, in a
 * searchable one's open list), and the classes of the closed field, the
 * options and the group headings, so a short select and a searchable one
 * look and read the same.
 */
import type { ReactNode } from 'react';

import cn from '@/lib/cn';

import { matchRange } from './select-option-list';
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
 * A group's heading while a search is on: at normal weight, so the part of
 * it that matches can be semibold, as in an option's label. It keeps its
 * size and muted colour, so it still reads as a heading.
 */
export const searchedGroupHeading = cn(groupHeading, 'font-normal');

/**
 * The part of a label or a group's heading that matches the search:
 * semibold, in the text's own colour (a heading is muted around it) and
 * without a fill of its own, so it reads the same on the active option's
 * fill, in both modes. In forced colours it takes the system's colours for
 * a mark, which the person's theme chooses: left to itself, a `<mark>` would
 * keep the mark's text colour on no fill there, which can't be read.
 */
const matchMark =
  'bg-transparent font-semibold text-foreground forced-colors:bg-[Mark] forced-colors:text-[MarkText]';

/**
 * A text with the part that matches a search marked (`<mark>`), as the open
 * list shows it while something is typed (`matchRange`). Its text, and so
 * the name of the option or group it's in, stays the same.
 *
 * @param props - Component props.
 * @param props.text - The text: a label or a group's heading.
 * @param props.query - What's typed in the search.
 * @returns The text, with its match marked when it has one.
 */
export function MatchedText({ text, query }: { text: string; query: string }) {
  const range = matchRange(text, query);
  if (range === null) {
    return text;
  }
  return (
    <>
      {text.slice(0, range.start)}
      <mark className={matchMark}>{text.slice(range.start, range.end)}</mark>
      {text.slice(range.end)}
    </>
  );
}

/**
 * An option's label as the list and the closed select show it: its icon
 * first, if any, and the label marked with its language when it has one.
 * In the open list of a searchable select, the part that matches what's
 * typed is marked too ({@link MatchedText}); the closed select never marks it.
 *
 * @param props - Component props.
 * @param props.option - The option.
 * @param props.query - What's typed in the search, to mark the part of the label it matches.
 * @returns The label.
 */
export function OptionLabel({ option, query = '' }: { option: SelectOption; query?: string }) {
  const text = query ? <MatchedText text={option.label} query={query} /> : option.label;
  const label = option.lang ? <span lang={option.lang}>{text}</span> : text;
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
