/**
 * @file The logic of a select's list, free of React so it's tested on its
 * own: how options fall into groups, which ones a searchable select shows for
 * what's typed in its search, and where its keys move the active option.
 */

/** What grouping and filtering need to know about an option. */
export interface ListedOption {
  /** Visible text: what the search looks in. */
  label: string;
  /** The heading the option sits under, if any; the search looks in it too. */
  group?: string;
}

/** Options that follow each other under the same heading, or under none. */
export interface OptionGroup<T> {
  /** The heading, or `undefined` for options without a group. */
  heading: string | undefined;
  /** The options, in their order. */
  options: T[];
}

/** How far PageDown and PageUp move the active option. */
export const PAGE_STEP = 10;

/**
 * Puts options that follow each other with the same `group` together, in
 * their order. Options without a group form groups without a heading.
 *
 * @param options - The options, already in the order they're shown.
 * @returns The groups.
 */
export function groupOptions<T extends ListedOption>(options: readonly T[]): OptionGroup<T>[] {
  const groups: OptionGroup<T>[] = [];
  options.forEach((option) => {
    const last = groups.at(-1);
    if (last && last.heading === option.group) {
      last.options.push(option);
    } else {
      groups.push({ heading: option.group, options: [option] });
    }
  });
  return groups;
}

/**
 * Text as the search compares it: in lower case, without accents, and with
 * the minus sign that offsets are written with ("UTC−05:00") read as a
 * hyphen, so "-05" finds it.
 *
 * @param text - A label, a heading or what was typed.
 * @returns The text to compare.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replaceAll('−', '-')
    .toLowerCase();
}

/** Where a search matches a text, in the text's own characters: from `start` up to `end`. */
export interface MatchRange {
  /** The place of the match's first character. */
  start: number;
  /** The place right after its last character. */
  end: number;
}

/**
 * A text of characters that each fold to exactly one character: printable
 * ASCII but for the spacing accents `^` and `` ` ``, the letters of Latin-1
 * and Latin Extended-A (an accented letter folds to its base letter), and
 * the minus sign. Such a text folds letter for letter, at the same length,
 * so a match's place in the folded text is its place in the text.
 */
const FOLDS_LETTER_FOR_LETTER = /^[\x20-\x5d\x5f\x61-\x7eÀ-ÖØ-öø-ſ−]*$/u;

/** A combining mark: an accent written as a character of its own, after its letter. */
const COMBINING_MARK = /^\p{M}$/u;

/**
 * Maps a span of a folded text back onto the text, by how long each of the
 * text's characters is folded: an accent written as a character of its own
 * folds to nothing, a Korean syllable to its two or three letters. A span
 * starts at the character its first folded character came from and ends
 * after the one its last came from.
 *
 * Folded one character at a time, a text is as long as folded as a whole;
 * only a letter's form can differ (the final sigma, "ς" for "σ", depends on
 * what follows). Should the lengths ever differ, the whole text is the span:
 * it matched.
 *
 * @param text - The text, as it's shown.
 * @param folded - The text folded as a whole ({@link foldForSearch}).
 * @param from - Where the span starts in the folded text.
 * @param to - Where it ends in the folded text.
 * @returns The span in the text.
 */
function spanInText(text: string, folded: string, from: number, to: number): MatchRange {
  // For each character of the folded text: where the character it came from starts and ends.
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const character of text) {
    const { length } = foldForSearch(character);
    for (let i = 0; i < length; i += 1) {
      starts.push(at);
      ends.push(at + character.length);
    }
    at += character.length;
  }
  const start = starts[from];
  const end = ends[to - 1];
  if (starts.length !== folded.length || start === undefined || end === undefined) {
    return { start: 0, end: text.length };
  }
  return { start, end };
}

/**
 * Where what's typed matches a text (a label or a heading), as
 * {@link matchingOptions} matches it: in the text folded as a whole (case
 * and accents aside), mapped back onto the text as it's written. A match
 * covers whole characters of the text, with the accents written as
 * characters of their own after its last letter.
 *
 * It runs for every option shown, on every change of the list, so it does
 * no more than it must: a text that doesn't match is done after one fold,
 * and only a text whose characters may not fold one to one is mapped back
 * character by character ({@link spanInText}).
 *
 * @param text - The text, as it's shown.
 * @param query - What's typed in the search.
 * @returns The first match, or `null` when nothing's typed or the text doesn't match.
 */
export function matchRange(text: string, query: string): MatchRange | null {
  const typed = foldForSearch(query.trim());
  if (typed === '') {
    return null;
  }
  const folded = foldForSearch(text);
  const found = folded.indexOf(typed);
  if (found === -1) {
    return null;
  }
  if (FOLDS_LETTER_FOR_LETTER.test(text)) {
    return { start: found, end: found + typed.length };
  }
  const span = spanInText(text, folded, found, found + typed.length);
  let { end } = span;
  // An accent written after the last letter stays with it; any other character that folds to
  // nothing (a spacing accent, a middle dot) is a character of its own.
  for (
    let next = text.codePointAt(end);
    next !== undefined && COMBINING_MARK.test(String.fromCodePoint(next));
    next = text.codePointAt(end)
  ) {
    end += String.fromCodePoint(next).length;
  }
  return { start: span.start, end };
}

/**
 * The options a search shows: those whose label, or whose group's heading,
 * contains what was typed (case and accents aside), in their order. Nothing
 * typed (or only spaces) shows every option.
 *
 * @param options - Every option.
 * @param query - What's typed in the search.
 * @returns The options that match.
 */
export function matchingOptions<T extends ListedOption>(options: readonly T[], query: string): T[] {
  const typed = foldForSearch(query.trim());
  if (typed === '') {
    return [...options];
  }
  return options.filter(
    ({ label, group }) =>
      foldForSearch(label).includes(typed) ||
      (group !== undefined && foldForSearch(group).includes(typed)),
  );
}

/**
 * Where a key moves the active option in a list of options: ArrowDown and
 * ArrowUp one step, PageDown and PageUp {@link PAGE_STEP} steps, Home and End
 * to the first and the last. It stops at the ends rather than wrapping
 * around.
 *
 * @param key - The key pressed (`KeyboardEvent.key`).
 * @param active - The place of the active option, or -1 for none.
 * @param count - How many options the list shows.
 * @returns The new place, or `undefined` when the key doesn't move it (another key, or an empty list).
 */
export function movedIndex(key: string, active: number, count: number): number | undefined {
  if (count === 0) {
    return undefined;
  }
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return Math.min(active + 1, last);
    case 'ArrowUp':
      return Math.max(active - 1, 0);
    case 'PageDown':
      return Math.min(Math.max(active, 0) + PAGE_STEP, last);
    case 'PageUp':
      return Math.max(active - PAGE_STEP, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return undefined;
  }
}
