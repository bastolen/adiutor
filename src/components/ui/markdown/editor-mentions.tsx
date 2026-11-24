/**
 * @file The list of people at "@" in the editor: what it holds while the
 * writer types a name, how the keyboard moves through it, and the popover
 * that shows it at the cursor.
 *
 * The editor's "@" trigger (`editor-extensions.ts`) tells a
 * {@link MentionList} what's typed and where; the list finds the people that
 * match and the popover shows them, until someone is picked, the list is
 * closed, or what's typed can't be a name any more. The focus stays in the
 * text all along:
 * the arrow keys and Enter go to the list through the editor, and the text
 * points at the option they're on (`aria-activedescendant`).
 */
'use client';

import { useTranslations } from 'next-intl';
import { Popover } from 'radix-ui';
import { useMemo, useSyncExternalStore } from 'react';

import cn from '@/lib/cn';

import Badge from '../badge';
import { keepFocus } from '../focus-fallback';
import { foldForSearch } from '../select-option-list';
import { SCREEN_GUTTER } from '../styles';
import type { MentionChoice, MentionLoader } from './mentions';

/** The most people the list shows at a time; typing more of a name narrows it. */
const MAX_SHOWN = 8;

/** What the list shows at one moment. */
export interface MentionListState {
  /** The people that match what's typed after the "@", the best matches first. */
  choices: MentionChoice[];
  /** The place in `choices` of the one Enter picks. */
  active: number;
  /** Whether the people are still being asked for, are there, or couldn't be loaded. */
  status: 'loading' | 'ready' | 'failed';
  /**
   * Where the "@" and what's typed after it are on the screen.
   *
   * @returns Their box, or `null` when it can't be measured.
   */
  rect: () => DOMRect | null;
}

/** What the editor's trigger tells the list while a name is typed. */
export interface TypedMention {
  /** What's typed after the "@" so far. */
  query: string;
  /**
   * Where that is on the screen.
   *
   * @returns Its box, or `null` when it can't be measured.
   */
  rect: () => DOMRect | null;
  /**
   * Puts the mention of someone in the text, in place of what was typed.
   *
   * @param choice - Who was picked.
   */
  pick: (choice: MentionChoice) => void;
  /** Closes the list without a mention; what was typed stays text. */
  close: () => void;
}

/** The list of people at "@": what the trigger feeds, and the popover reads. */
export interface MentionList {
  /**
   * Follows the list's changes (for `useSyncExternalStore`).
   *
   * @param listener - Called after each change.
   * @returns Stops following.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * What the list shows now.
   *
   * @returns The state, or `null` while the list is closed.
   */
  getSnapshot: () => MentionListState | null;
  /**
   * Takes another source of people; what the last one gave is forgotten.
   *
   * @param load - Gives the people.
   */
  setLoader: (load: MentionLoader) => void;
  /**
   * Opens the list, or follows what's typed.
   *
   * @param typed - What's typed after the "@", and where.
   */
  show: (typed: TypedMention) => void;
  /** Closes the list: the trigger is done, with or without a mention. */
  hide: () => void;
  /** Asks the trigger to close the list, as Escape or a click elsewhere does. */
  dismiss: () => void;
  /**
   * Lets the list have a key the writer pressed in the text.
   *
   * @param event - The key.
   * @returns Whether the list took it; otherwise it's the text's.
   */
  keyDown: (event: Pick<KeyboardEvent, 'key' | 'isComposing'>) => boolean;
  /**
   * Makes someone the one Enter picks (the pointer is on them).
   *
   * @param index - Their place in the list.
   */
  activate: (index: number) => void;
  /**
   * Mentions someone in the list.
   *
   * @param index - Their place in the list.
   */
  choose: (index: number) => void;
}

/**
 * How well a name matches what was typed: best when the name starts with
 * it, then when one of its words does, then when it's anywhere in the name.
 *
 * @param name - The name, folded for the search (`foldForSearch`: "jose" finds José).
 * @param typed - What was typed, folded the same way.
 * @returns A rank from 0 (best), or `null` for a name that doesn't match.
 */
function matchRank(name: string, typed: string): number | null {
  if (name.startsWith(typed)) {
    return 0;
  }
  if (name.split(/\s+/).some((word) => word.startsWith(typed))) {
    return 1;
  }
  return name.includes(typed) ? 2 : null;
}

/**
 * Finds the people whose names match what was typed, the best matches
 * first and otherwise in the order they were given.
 *
 * @param people - Everyone who can be mentioned.
 * @param query - What's typed after the "@".
 * @returns At most {@link MAX_SHOWN} people.
 */
export function matchingChoices(people: readonly MentionChoice[], query: string): MentionChoice[] {
  const typed = foldForSearch(query);
  return people
    .flatMap((person, place) => {
      const rank = matchRank(foldForSearch(person.name), typed);
      return rank === null ? [] : [{ person, rank, place }];
    })
    .sort((a, b) => a.rank - b.rank || a.place - b.place)
    .slice(0, MAX_SHOWN)
    .map(({ person }) => person);
}

/**
 * Makes the list for one editor. The people are asked for the first time
 * the list opens, and kept until another loader takes the first one's place.
 *
 * @param firstLoader - Gives the people who can be mentioned.
 * @returns The list.
 */
export function createMentionList(firstLoader: MentionLoader): MentionList {
  const listeners = new Set<() => void>();
  let load = firstLoader;
  // What the loader gave; `null` until it has, and after it failed.
  let people: MentionChoice[] | null = null;
  let failed = false;
  // The loader that's being waited for, so an answer for an earlier one is dropped.
  let asking: MentionLoader | null = null;
  let typed: TypedMention | null = null;
  let state: MentionListState | null = null;

  /**
   * Works out what the list shows now, and tells whoever follows it.
   *
   * @param active - The place of the one Enter picks.
   */
  const refresh = (active = 0) => {
    if (typed === null) {
      state = null;
    } else {
      const choices = people === null ? [] : matchingChoices(people, typed.query);
      let status: MentionListState['status'] = 'ready';
      if (people === null) {
        status = failed ? 'failed' : 'loading';
      }
      state = {
        choices,
        active: Math.min(Math.max(active, 0), Math.max(choices.length - 1, 0)),
        status,
        rect: typed.rect,
      };
      // More than one word that's nobody's name: the "@" wasn't the start of a mention ("@ 5 pm").
      // The list closes, a moment later: the editor is in the middle of telling what's typed.
      if (status === 'ready' && choices.length === 0 && /\s/.test(typed.query)) {
        const stale = typed;
        queueMicrotask(() => {
          if (typed === stale) {
            stale.close();
          }
        });
      }
    }
    listeners.forEach((listener) => listener());
  };

  /** Asks the loader for the people, unless they're there or being asked for. */
  const ask = () => {
    if (people !== null || asking === load) {
      return;
    }
    const asked = load;
    asking = asked;
    failed = false;
    asked().then(
      (found) => {
        if (asking === asked) {
          asking = null;
          people = found;
          refresh();
        }
      },
      () => {
        if (asking === asked) {
          asking = null;
          failed = true;
          refresh();
        }
      },
    );
  };

  return {
    /**
     * Follows the list's changes.
     *
     * @param listener - Called after each change.
     * @returns Stops following.
     */
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * What the list shows now.
     *
     * @returns The state, or `null` while the list is closed.
     */
    getSnapshot: () => state,
    /**
     * Takes another source of people. What the last one gave is forgotten, and
     * an open list asks the new one at once.
     *
     * @param next - Gives the people.
     */
    setLoader: (next) => {
      if (next !== load) {
        load = next;
        people = null;
        failed = false;
        asking = null;
        if (typed !== null) {
          ask();
          refresh();
        }
      }
    },
    /**
     * Opens the list, or follows what's typed.
     *
     * @param next - What's typed after the "@", and where.
     */
    show: (next) => {
      // Another name is typed: the first match is the one Enter picks again.
      const sameQuery = typed?.query === next.query;
      typed = next;
      ask();
      refresh(sameQuery ? (state?.active ?? 0) : 0);
    },
    /** Closes the list: the trigger is done. */
    hide: () => {
      typed = null;
      refresh();
    },
    /** Asks the trigger to close the list; what was typed stays text. */
    dismiss: () => {
      typed?.close();
    },
    /**
     * Lets the list have a key: the arrows move through the people, around at
     * the ends, and Enter mentions the one they're on. Without anyone to pick,
     * every key is the text's.
     *
     * @param event - The key.
     * @returns Whether the list took it.
     */
    keyDown: (event) => {
      // A key that belongs to a text being composed (an input method) is the text's.
      if (state === null || typed === null || event.isComposing || state.choices.length === 0) {
        return false;
      }
      const { choices, active } = state;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        refresh((active + step + choices.length) % choices.length);
        return true;
      }
      const choice = choices[active];
      if (event.key === 'Enter' && choice) {
        typed.pick(choice);
        return true;
      }
      return false;
    },
    /**
     * Makes someone the one Enter picks.
     *
     * @param index - Their place in the list.
     */
    activate: (index) => {
      if (state !== null && index !== state.active) {
        refresh(index);
      }
    },
    /**
     * Mentions someone in the list.
     *
     * @param index - Their place in the list.
     */
    choose: (index) => {
      const choice = state?.choices[index];
      if (choice) {
        typed?.pick(choice);
      }
    },
  };
}

/**
 * The ID of an option of a list, which the text points at while it's the
 * one Enter picks.
 *
 * @param listId - The list's ID.
 * @param index - The option's place in the list.
 * @returns The option's ID.
 */
export function mentionOptionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

/**
 * The list of people at "@", shown at the cursor while a name is typed. It's
 * a layer of its own, so Escape closes it before anything under it (the
 * editor's large view), and a click elsewhere closes it too. The options
 * are picked with a click or, from the text, with the arrow keys and Enter.
 * While the people are asked for, when nobody matches and when they couldn't
 * be loaded, it says so instead.
 *
 * @param props - Component props.
 * @param props.list - The list to show.
 * @param props.listId - The ID of the list's element, which the text refers to.
 * @returns The popover, or nothing while the list is closed.
 */
export default function MentionPopover({ list, listId }: { list: MentionList; listId: string }) {
  const t = useTranslations('common.markdown.mentions');
  const state = useSyncExternalStore(list.subscribe, list.getSnapshot, () => null);
  // What the popover is placed against: where the name is typed. A new one each time the list
  // changes, so the popover follows the text.
  const anchor = useMemo(
    () => ({
      current: {
        /**
         * Measures where the name is typed.
         *
         * @returns Its box; an empty one when it can't be measured.
         */
        getBoundingClientRect: () => state?.rect() ?? new DOMRect(),
      },
    }),
    [state],
  );
  if (state === null) {
    return null;
  }
  const messages = { loading: t('loading'), failed: t('failed'), ready: t('none') };

  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          list.dismiss();
        }
      }}
    >
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          // Not a dialog: a list the text controls. The list inside has the role.
          role="presentation"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={SCREEN_GUTTER}
          onOpenAutoFocus={keepFocus}
          onCloseAutoFocus={keepFocus}
          className="z-50 max-w-[min(20rem,calc(100vw-2rem))] min-w-48 rounded-lg border border-border bg-raised p-1 shadow-lg"
        >
          {state.choices.length === 0 ? (
            <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
              {messages[state.status]}
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label={t('label')} className="flex flex-col">
              {state.choices.map((choice, index) => (
                // Picked from the text with the keyboard, which keeps the focus; a click is the
                // pointer's way.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- The keys go through the text (see the file comment).
                <li
                  key={choice.key}
                  id={mentionOptionId(listId, index)}
                  role="option"
                  aria-selected={index === state.active}
                  // The press must not take the focus out of the text.
                  onMouseDown={keepFocus}
                  onMouseMove={() => list.activate(index)}
                  onClick={() => list.choose(index)}
                  className={cn(
                    'flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground select-none',
                    'aria-selected:bg-raised-muted aria-selected:outline-2 aria-selected:-outline-offset-2 aria-selected:outline-ring',
                  )}
                >
                  <span className="min-w-0 wrap-anywhere">{choice.name}</span>
                  {choice.label !== null && <Badge>{choice.label}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
