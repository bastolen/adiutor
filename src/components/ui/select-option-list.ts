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
