/**
 * @file The keyboard handling of {@link SearchableSelect}: what the keys do
 * on the closed field and in the search field, and how the list scrolls to
 * show the option they move to. The component gives each handler what it
 * acts on, so the handlers hold no state of their own.
 */
import type { KeyboardEvent, RefObject } from 'react';

import { movedIndex } from './select-option-list';

/**
 * Whether a key press types a character (a letter, a digit, a sign), rather
 * than being a shortcut or a key like Enter or the arrows. Space opens the
 * field like a click, so it doesn't count.
 *
 * @param event - The key press.
 * @returns Whether it types.
 */
function typesCharacter(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

/** What a key on the closed field acts on. */
export interface TriggerKeyActions {
  /** Whether the field is busy: no key opens it. */
  busy: boolean;
  /** Whether the panel is open. */
  open: boolean;
  /**
   * Opens the panel.
   *
   * @param typed - What the search starts with; nothing for an empty search.
   */
  openList: (typed?: string) => void;
  /**
   * Adds a character to the search and gives it the focus: the panel is
   * open, but the search hasn't taken the focus yet.
   *
   * @param character - The character typed.
   */
  typeInSearch: (character: string) => void;
}

/**
 * The closed field's keys: the arrow keys open it, and a typed character
 * opens it with that character in the search (or, when it's open but the
 * search hasn't taken the focus yet, adds it to the search).
 *
 * @param event - The key press.
 * @param actions - What the keys act on.
 */
export function onTriggerKey(
  event: KeyboardEvent<HTMLButtonElement>,
  actions: TriggerKeyActions,
): void {
  if (actions.busy) {
    return;
  }
  if (typesCharacter(event)) {
    event.preventDefault();
    if (actions.open) {
      actions.typeInSearch(event.key);
    } else {
      actions.openList(event.key);
    }
  } else if (!actions.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    actions.openList();
  }
}

/** What a key in the search field acts on. */
export interface SearchKeyActions {
  /** The place of the active option among the options shown, or -1 for none. */
  activeIndex: number;
  /** How many options the list shows. */
  count: number;
  /** Picks the active option, when there is one. */
  pickActive: () => void;
  /** Closes the panel without a change. */
  close: () => void;
  /**
   * Makes an option the active one.
   *
   * @param index - Its place among the options shown.
   */
  moveTo: (index: number) => void;
}

/**
 * The search field's keys: the arrow, Page, Home and End keys move the
 * active option, Enter picks it, and Tab closes the panel without a
 * change (Escape does too, through Radix). Nothing while a character is
 * being composed (an input method's Enter takes the composition).
 *
 * @param event - The key press.
 * @param actions - What the keys act on.
 */
export function onSearchKey(
  event: KeyboardEvent<HTMLInputElement>,
  actions: SearchKeyActions,
): void {
  if (event.nativeEvent.isComposing) {
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    actions.pickActive();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    actions.close();
    return;
  }
  const next = movedIndex(event.key, actions.activeIndex, actions.count);
  if (next !== undefined) {
    event.preventDefault();
    actions.moveTo(next);
  }
}

/**
 * Where the list must scroll to show an option: just far enough to bring it
 * below the sticky heading of its group or above the list's bottom, or to
 * put it in the middle (when the list opens). Only the list scrolls, never
 * the page: the panel may not be in place yet.
 *
 * @param list - The list's scrolling element.
 * @param option - The option to show.
 * @param center - Whether to put it in the middle.
 * @returns The list's new `scrollTop`, or `undefined` when the option is in view already.
 */
function scrollTopToShow(
  list: HTMLElement,
  option: HTMLElement,
  center: boolean,
): number | undefined {
  const listBox = list.getBoundingClientRect();
  const optionBox = option.getBoundingClientRect();
  const top = list.scrollTop + optionBox.top - listBox.top;
  const bottom = top + optionBox.height;
  const heading =
    option.closest('[role="group"]')?.querySelector<HTMLElement>('[data-group-heading]')
      ?.offsetHeight ?? 0;
  if (center) {
    return top - (list.clientHeight - optionBox.height) / 2;
  }
  if (top - heading < list.scrollTop) {
    return top - heading;
  }
  if (bottom > list.scrollTop + list.clientHeight) {
    return bottom - list.clientHeight;
  }
  return undefined;
}

/**
 * Scrolls the list to show an option ({@link scrollTopToShow}): the one the
 * keys moved to, or the chosen one in the middle when the list appears.
 *
 * @param listRef - The list's element.
 * @param optionId - The option's ID.
 * @param center - Whether to put it in the middle.
 */
export function showOption(
  listRef: RefObject<HTMLDivElement | null>,
  optionId: string | undefined,
  center: boolean,
): void {
  const list = listRef.current;
  const option = optionId === undefined ? null : document.getElementById(optionId);
  const top = list && option ? scrollTopToShow(list, option, center) : undefined;
  if (list && top !== undefined) {
    list.scrollTop = top;
  }
}
