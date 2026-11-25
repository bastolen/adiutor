/**
 * @file How the reader reads a request's activity, on its page: the "Show"
 * menu (which groups of entries the activity shows) and the order menu
 * (oldest or newest first) in the Conversation card's heading, the error a
 * failed save shows above the activity, and the "Show everything" button of
 * an activity that a choice leaves empty. Each choice is saved with the
 * reader's account (`saveActivityViewAction`) and the page refreshed to show
 * it; the menus show it at once. What the groups show, and how a choice is
 * tidied, is in `src/lib/requests/activity.ts`. Its text comes from
 * `requests.detail.activity`, which the page passes through `ClientMessages`.
 */
'use client';

import { ArrowDownUp, ListFilter } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  type TransitionStartFunction,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useTransition,
} from 'react';

import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import {
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/dropdown-menu';
import restoreFocusIfLost from '@/components/ui/focus-fallback';
import { useSignedInAs } from '@/components/ui/signed-in-as';
import Spinner from '@/components/ui/spinner';
import { useTransientState } from '@/components/ui/use-transient-state';
import { formatList } from '@/lib/format';
import {
  ACTIVITY_ORDERS,
  type ActivityGroup,
  type ActivityView,
  isActivityGroupShown,
  isActivityOrder,
  isIncludedActivityGroup,
  withActivityGroup,
} from '@/lib/requests';

import { saveActivityViewAction } from './actions';

/** What the parts of the activity's view share, through {@link ActivityViewProvider}. */
interface ActivityViewContextValue {
  /** The view as the menus show it: the saved one, or the one being saved. */
  view: ActivityView;
  /** The groups the reader is offered (`offeredActivityGroups`). */
  offered: readonly ActivityGroup[];
  /** Whether changes are off: a staff member is signed in as the reader. */
  changesOff: boolean;
  /**
   * Saves a change of the view in a transition of the caller's, so only the
   * control that started it shows that it's busy.
   */
  save: (change: Partial<ActivityView>, startTransition: TransitionStartFunction) => void;
  /** Why the last save failed, or `null`. */
  error: string | null;
  /** Hides the error. */
  dismissError: () => void;
}

/** The activity's view, for the menus, the error and the "Show everything" button. */
const ActivityViewContext = createContext<ActivityViewContextValue | null>(null);

/**
 * Reads the activity's view from the nearest {@link ActivityViewProvider}.
 *
 * @returns The view and how to change it.
 * @throws {Error} Outside an `ActivityViewProvider`.
 */
function useActivityView(): ActivityViewContextValue {
  const value = useContext(ActivityViewContext);
  if (!value) {
    throw new Error('The activity’s view is used outside an ActivityViewProvider');
  }
  return value;
}

/**
 * Holds the activity's view for everything in the Conversation card: the
 * saved view, shown changed at once while a change is saved (it goes back if
 * the save fails), and the error of a failed save. The error is transient,
 * so it isn't still there when the reader comes back to the page.
 *
 * @param props - Component props.
 * @param props.view - The view as the reader saved it, applied to them (`RequestDetail.activity`).
 * @param props.offered - The groups the reader is offered.
 * @param props.children - The card.
 */
export function ActivityViewProvider({
  view,
  offered,
  children,
}: {
  view: ActivityView;
  offered: readonly ActivityGroup[];
  children: ReactNode;
}) {
  const [shown, showChange] = useOptimistic(
    view,
    (current: ActivityView, change: Partial<ActivityView>) => ({ ...current, ...change }),
  );
  const [error, setError] = useTransientState<string | null>(null);
  const changesOff = useSignedInAs();

  const save = useCallback(
    (change: Partial<ActivityView>, startTransition: TransitionStartFunction) => {
      startTransition(async () => {
        showChange(change);
        setError(null);
        const result = await saveActivityViewAction(change);
        if (!result.ok) {
          setError(result.message);
        }
      });
    },
    [setError, showChange],
  );
  const dismissError = useCallback(() => {
    setError(null);
  }, [setError]);

  const value = useMemo(
    () => ({ view: shown, offered, changesOff, save, error, dismissError }),
    [shown, offered, changesOff, save, error, dismissError],
  );
  return <ActivityViewContext.Provider value={value}>{children}</ActivityViewContext.Provider>;
}

/**
 * The "Show" menu: a button that says what the activity shows ("Show:
 * Everything", "Show: Replies and Status changes") and opens a checkbox per
 * group the reader is offered, under "Everything". Ticking or unticking one
 * saves the choice and keeps the menu open, so several can be changed in a
 * row; unticking the last shows everything again. For the staff, Replies
 * says it includes the internal notes, and while it's ticked, Internal notes
 * is ticked along with it and can't be unticked on its own. While a choice
 * is saved the button shows a spinner and stays focusable.
 *
 * @returns The menu's button (the menu opens in a portal).
 */
function ShowMenu() {
  const t = useTranslations('requests.detail.activity');
  const locale = useLocale();
  const { view, offered, changesOff, save } = useActivityView();
  const [open, setOpen] = useTransientState(false);
  const [pending, startTransition] = useTransition();
  const { groups } = view;
  const chosen =
    groups === null
      ? t('everything')
      : formatList(
          groups.map((group) => t('group', { group })),
          locale,
        );

  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={changesOff}
          aria-busy={pending || undefined}
        >
          {pending ? <Spinner /> : <ListFilter aria-hidden="true" />}
          {t('show', { groups: chosen })}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>{t('showMenu')}</MenuLabel>
        <MenuCheckboxItem
          label={t('everything')}
          checked={groups === null}
          // Everything is where unticking the last group ends; it isn't unticked itself.
          onCheckedChange={(on) => {
            if (on) {
              save({ groups: null }, startTransition);
            }
          }}
        />
        <MenuSeparator />
        {offered.map((group) => {
          const included = isIncludedActivityGroup(group, groups);
          let hint: string | undefined;
          if (group === 'replies' && offered.includes('notes')) {
            hint = t('repliesWithNotes');
          } else if (included) {
            hint = t('includedInReplies');
          }
          return (
            <MenuCheckboxItem
              key={group}
              label={t('group', { group })}
              hint={hint}
              checked={isActivityGroupShown(group, groups)}
              included={included}
              onCheckedChange={(on) => {
                save({ groups: withActivityGroup(groups, group, on, offered) }, startTransition);
              }}
            />
          );
        })}
      </MenuContent>
    </MenuRoot>
  );
}

/**
 * The order menu: a button that says the order ("Oldest first") and opens
 * the two orders, the current one checked. Choosing one saves it and closes
 * the menu, with focus back on the button; the button shows a spinner until
 * the activity arrives in its new order.
 *
 * @returns The menu's button (the menu opens in a portal).
 */
function OrderMenu() {
  const t = useTranslations('requests.detail.activity');
  const { view, changesOff, save } = useActivityView();
  const [open, setOpen] = useTransientState(false);
  const [pending, startTransition] = useTransition();

  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={changesOff}
          aria-busy={pending || undefined}
        >
          {pending ? <Spinner /> : <ArrowDownUp aria-hidden="true" />}
          {t('order', { order: view.order })}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>{t('orderMenu')}</MenuLabel>
        <MenuRadioGroup
          value={view.order}
          onValueChange={(order) => {
            if (isActivityOrder(order) && order !== view.order) {
              save({ order }, startTransition);
            }
          }}
        >
          {ACTIVITY_ORDERS.map((order) => (
            <MenuRadioItem key={order} value={order}>
              {t('order', { order })}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}

/**
 * The two menus for the Conversation card's heading: what the activity shows
 * and its order. Off while a staff member is signed in as the reader: it's
 * the reader's own choice, which the server refuses to change then.
 */
export function ActivityControls() {
  return (
    <>
      <ShowMenu />
      <OrderMenu />
    </>
  );
}

/**
 * Why saving the view failed, above the activity, and as a toast; the reader
 * can dismiss it. Nothing while there's no error.
 *
 * @returns The error, or nothing.
 */
export function ActivityError() {
  const { error, dismissError } = useActivityView();
  if (!error) {
    return null;
  }
  return (
    <Alert tone="error" alsoToast onDismiss={dismissError}>
      {error}
    </Alert>
  );
}

/**
 * The button that shows everything again when the groups chosen leave the
 * activity empty. Once everything arrives the button is gone, and focus
 * moves to the card's heading instead of falling to the page.
 *
 * @param props - Component props.
 * @param props.children - The button's text.
 */
export function ShowEverythingButton({ children }: { children: ReactNode }) {
  const { changesOff, save } = useActivityView();
  const [pending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef(false);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      // Everything arrived and took this button away: don't leave focus on <body>.
      if (pressed.current) {
        restoreFocusIfLost(button);
      }
    };
  }, []);

  return (
    <Button
      ref={buttonRef}
      variant="secondary"
      size="sm"
      loading={pending}
      disabled={changesOff}
      onClick={() => {
        pressed.current = true;
        save({ groups: null }, startTransition);
      }}
    >
      {children}
    </Button>
  );
}
