/**
 * @file The searchable kind of {@link SelectField}, for a field with many
 * options: the closed field opens a panel with a search field above the
 * list, and the list shows only the options whose label (or group heading)
 * contains what's typed, with that part marked. Built on Radix Popover, following the WAI-ARIA 1.2
 * combobox pattern: the closed field is a select-only combobox that opens
 * the panel, and the search field in it is an editable combobox that keeps
 * the focus while the arrow keys move through the list
 * (`aria-activedescendant`). Only `SelectField` renders it. What the keys
 * do is in `searchable-select-keys.ts`.
 */
'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Popover } from 'radix-ui';
import {
  type KeyboardEvent,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import cn from '@/lib/cn';

import { onSearchKey, onTriggerKey, showOption } from './searchable-select-keys';
import { groupOptions, matchingOptions } from './select-option-list';
import {
  groupHeading,
  MatchedText,
  optionCheck,
  optionItem,
  OptionLabel,
  searchedGroupHeading,
  type SelectOption,
  selectTrigger,
} from './select-options';
import { fieldControl, SCREEN_GUTTER } from './styles';
import { useTransientState } from './use-transient-state';

/** How long typing pauses before the number of matches is read out, in milliseconds. */
const ANNOUNCE_DELAY = 400;

/** Props for {@link SearchableSelect}. */
interface SearchableSelectProps {
  /** The closed field's ID, which the visible label points at (`htmlFor`). */
  id: string;
  /** The visible label's ID: it names the panel, the search field and the list too. */
  labelId: string;
  /** The help text's ID, if the field has one (`aria-describedby`). */
  descriptionId?: string;
  /** The choices. */
  options: readonly SelectOption[];
  /** Field name, for forms (submitted through a hidden input). */
  name?: string;
  /** Initial value (uncontrolled). */
  defaultValue?: string;
  /** Current value (controlled). */
  value?: string;
  /** Text shown while nothing is chosen (when the value is `''`). */
  placeholder?: string;
  /** Called with the new value once a different choice is picked. */
  onValueChange?: (value: string) => void;
  /** Disable the field. */
  disabled: boolean;
  /** Busy: focusable, but doesn't open. */
  busy: boolean;
  /** Extra classes for the closed field. */
  className: string;
}

/**
 * Keeps the focus where it is: a press on an option must not take it from
 * the search field.
 *
 * @param event - The press.
 * @param event.preventDefault - Stops the focus moving.
 */
function keepFocus(event: { preventDefault: () => void }) {
  event.preventDefault();
}

/**
 * A select whose list can be searched, for a field with many options.
 *
 * The closed field looks and reads like the short select: a combobox named
 * by the visible label that shows the chosen option. Opening it (a click,
 * Enter, Space or the arrow keys) opens a panel with a search field, which
 * takes the focus, and the list under it with the chosen option in view.
 * Typing a character on the closed field opens it with that character in
 * the search.
 *
 * Typing filters the list at once, and shows the part of each option's
 * label, or of its group's heading, that matches in semibold
 * (`MatchedText`; the headings are at normal weight while a search is on).
 * The first option that matches becomes the active one.
 * The arrow keys move it one option, PageDown and PageUp ten, Home and End
 * to the first and the last; the active option is
 * filled and outlined, like the short select's. Enter (or a click) picks it
 * and closes the panel with the focus back on the field. Escape, Tab,
 * Shift+Tab or a click outside close it without changing the choice. A
 * screen reader hears how many options match once typing pauses, and
 * nothing matching is said on screen too.
 *
 * The value is submitted through a hidden input, which the server renders,
 * so a form sends the value it starts with before JavaScript loads, as the
 * short select's does. A form reset brings an uncontrolled field back to
 * its `defaultValue`. While `busy` it keeps the focus but doesn't open.
 * The panel and what's typed are gone when the user comes back to the page
 * (`useTransientState`), and the search starts empty each time it opens.
 *
 * @param props - Component props.
 * @param props.id - The closed field's ID.
 * @param props.labelId - The visible label's ID.
 * @param props.descriptionId - The help text's ID.
 * @param props.options - The choices.
 * @param props.name - Field name.
 * @param props.defaultValue - Initial value.
 * @param props.value - Current value.
 * @param props.placeholder - Text shown while nothing is chosen.
 * @param props.onValueChange - Called when a different choice is picked.
 * @param props.disabled - Disabled state.
 * @param props.busy - Busy state.
 * @param props.className - Extra classes for the closed field.
 * @returns The closed field, its hidden input and, while open, the panel.
 */
export default function SearchableSelect({
  id,
  labelId,
  descriptionId = undefined,
  options,
  name = undefined,
  defaultValue = undefined,
  value = undefined,
  placeholder = undefined,
  onValueChange = undefined,
  disabled,
  busy,
  className,
}: SearchableSelectProps) {
  const t = useTranslations('common.select');
  const listId = `${id}-list`;
  const panelId = `${id}-panel`;
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '');
  const current = value ?? uncontrolled;
  const [open, setOpen] = useTransientState(false);
  const [query, setQuery] = useTransientState('');
  // The option the keys or the pointer moved to, and the search it was in; any other search
  // makes its first match the active option again.
  const [pointer, setPointer] = useState<{ query: string; value: string } | null>(null);
  // What the status says, a moment after typing pauses.
  const [announcement, setAnnouncement] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const places = useMemo(
    () => new Map(options.map((option, place) => [option.value, place])),
    [options],
  );
  const shown = useMemo(() => matchingOptions(options, query), [options, query]);
  // While a search is on, the headings drop to normal weight, so what matches in them stands out.
  const searching = query.trim() !== '';
  const groups = useMemo(() => groupOptions(shown), [shown]);
  const chosen = options.find((option) => option.value === current);

  let activeValue: string | undefined;
  if (pointer?.query === query && shown.some((option) => option.value === pointer.value)) {
    activeValue = pointer.value;
  } else if (query.trim() === '' && chosen) {
    activeValue = chosen.value;
  } else {
    activeValue = shown[0]?.value;
  }
  const activeIndex = shown.findIndex((option) => option.value === activeValue);
  /**
   * An option's element ID, by its place among all the options, so it stays
   * the same while the search changes what's shown.
   *
   * @param option - The option.
   * @returns Its ID.
   */
  const optionId = (option: SelectOption) => `${id}-option-${places.get(option.value) ?? 0}`;
  const active = shown[activeIndex];
  const activeId = active ? optionId(active) : undefined;

  // A form reset brings an uncontrolled field back to the value it started with, as the short
  // select does, so forms that edit a saved setting aren't cleared after a save.
  useEffect(() => {
    const form = triggerRef.current?.closest('form');
    if (!form || value !== undefined) {
      return undefined;
    }
    /** Puts the value back on the one the field started with. */
    const reset = () => {
      setUncontrolled(defaultValue ?? '');
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [defaultValue, value]);

  // The number of matches is read out once typing pauses, not at each key.
  useEffect(() => {
    if (!open || query.trim() === '') {
      return undefined;
    }
    const timer = setTimeout(
      () => setAnnouncement(t('results', { count: shown.length })),
      ANNOUNCE_DELAY,
    );
    return () => clearTimeout(timer);
  }, [open, query, shown.length, t]);

  // The active option stays in view as the keys move it.
  useEffect(() => {
    if (open) {
      showOption(listRef, activeId, false);
    }
  }, [activeId, open]);

  /** When the list appears, the active option (the chosen one) is put in its middle. */
  const listMounted: RefCallback<HTMLDivElement> = useCallback((list: HTMLDivElement | null) => {
    listRef.current = list;
    showOption(listRef, list?.querySelector('[aria-selected="true"]')?.id, true);
  }, []);

  /**
   * Opens the panel, if the field may open now.
   *
   * @param typed - What the search starts with: a character typed on the closed field.
   */
  const openList = (typed = '') => {
    if (busy || disabled) {
      return;
    }
    setQuery(typed);
    setPointer(null);
    setAnnouncement('');
    setOpen(true);
  };

  /** Closes the panel; the focus goes back to the field (Radix does that). */
  const closeList = () => {
    setOpen(false);
    setQuery('');
    setPointer(null);
    setAnnouncement('');
  };

  /**
   * Picks an option: it becomes the value (reported when it's a different
   * one), and the panel closes.
   *
   * @param next - The option's value.
   */
  const pick = (next: string) => {
    if (next !== current) {
      if (value === undefined) {
        setUncontrolled(next);
      }
      onValueChange?.(next);
    }
    closeList();
  };

  /**
   * The closed field's keys ({@link onTriggerKey}).
   *
   * @param event - The key press.
   */
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onTriggerKey(event, {
      busy,
      open,
      openList,
      /**
       * Adds a character to the search and gives it the focus.
       *
       * @param character - The character typed.
       */
      typeInSearch: (character) => {
        setQuery((typed) => `${typed}${character}`);
        searchRef.current?.focus();
      },
    });
  };

  /**
   * The search field's keys ({@link onSearchKey}).
   *
   * @param event - The key press.
   */
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onSearchKey(event, {
      activeIndex,
      count: shown.length,
      /** Picks the active option, when there is one. */
      pickActive: () => {
        if (active) {
          pick(active.value);
        }
      },
      close: closeList,
      /**
       * Makes the option at a place the active one, in this search.
       *
       * @param index - Its place among the options shown.
       */
      moveTo: (index) => {
        const option = shown[index];
        if (option) {
          setPointer({ query, value: option.value });
        }
      },
    });
  };

  /**
   * One option in the list.
   *
   * @param option - The option.
   * @returns Its element.
   */
  const renderOption = (option: SelectOption) => {
    const optionElementId = optionId(option);
    const isActive = option.value === activeValue;
    return (
      // Picked from the search field with the keyboard, which keeps the focus; a click is the
      // pointer's way.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- The keys go through the search field (aria-activedescendant).
      <div
        key={option.value}
        id={optionElementId}
        role="option"
        // Never focused (the search field keeps the focus), but focusable, as an option must be.
        tabIndex={-1}
        aria-selected={isActive}
        // With a description, the option's name is the label followed by the description, so it
        // contains all of its visible text (WCAG 2.5.3).
        aria-labelledby={
          option.description ? `${optionElementId}-label ${optionElementId}-description` : undefined
        }
        data-highlighted={isActive ? '' : undefined}
        onMouseDown={keepFocus}
        onPointerMove={() => {
          if (!isActive) {
            setPointer({ query, value: option.value });
          }
        }}
        onClick={() => pick(option.value)}
        className={optionItem}
      >
        {option.value === current && (
          <span className={optionCheck}>
            <Check aria-hidden="true" className="size-4 text-highlight" />
          </span>
        )}
        <span id={`${optionElementId}-label`}>
          <OptionLabel option={option} query={query} />
        </span>
        {/* A space between label and description in the text (not visible in the column layout). */}
        {option.description && ' '}
        {option.description && (
          <span id={`${optionElementId}-description`} className="text-xs text-muted-foreground">
            {option.description}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          if (next) {
            openList();
          } else {
            closeList();
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            id={id}
            role="combobox"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={panelId}
            disabled={disabled}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
            aria-describedby={descriptionId}
            data-placeholder={chosen ? undefined : ''}
            onKeyDown={onTriggerKeyDown}
            className={cn(selectTrigger, className)}
          >
            <span className="min-w-0">
              {chosen ? <OptionLabel option={chosen} /> : placeholder}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            id={panelId}
            aria-labelledby={labelId}
            align="start"
            sideOffset={4}
            collisionPadding={SCREEN_GUTTER}
            onOpenAutoFocus={(event) => {
              // The search field takes the focus, with its text cursor after what's typed.
              event.preventDefault();
              const search = searchRef.current;
              search?.focus();
              search?.setSelectionRange(search.value.length, search.value.length);
            }}
            className="z-50 flex max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)] min-w-64 flex-col overflow-hidden rounded-lg border border-border bg-raised text-foreground shadow-lg"
          >
            <div className="relative border-b border-border p-2">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-labelledby={labelId}
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t('searchPlaceholder')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (event.target.value.trim() === '') {
                    setAnnouncement('');
                  }
                }}
                onKeyDown={onSearchKeyDown}
                className={cn(fieldControl, 'pl-9')}
              />
            </div>
            <div
              ref={listMounted}
              id={listId}
              role="listbox"
              aria-labelledby={labelId}
              className="max-h-80 min-h-0 flex-1 overflow-y-auto p-1"
            >
              {groups.map((group, place) =>
                group.heading === undefined ? (
                  group.options.map(renderOption)
                ) : (
                  <div
                    key={`${group.heading}-${group.options[0]?.value ?? ''}`}
                    role="group"
                    aria-labelledby={`${listId}-group-${place}`}
                  >
                    <div
                      id={`${listId}-group-${place}`}
                      role="presentation"
                      data-group-heading=""
                      className={cn(
                        searching ? searchedGroupHeading : groupHeading,
                        'sticky top-0 z-10 bg-raised',
                      )}
                    >
                      <MatchedText text={group.heading} query={query} />
                    </div>
                    {group.options.map(renderOption)}
                  </div>
                ),
              )}
            </div>
            {shown.length === 0 && (
              <p className="px-3 pt-1 pb-3 text-sm text-muted-foreground">{t('noMatches')}</p>
            )}
            <p role="status" className="sr-only">
              {announcement}
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {name !== undefined && (
        <input type="hidden" name={name} value={current} disabled={disabled} />
      )}
    </>
  );
}
