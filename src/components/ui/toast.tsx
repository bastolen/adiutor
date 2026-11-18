/**
 * @file Toasts: short messages about the result of what the user just did,
 * built on Radix UI's Toast. The signed-in app shows every success as a
 * toast, and every error inline (next to the field or button) and as a toast
 * too, except an error an open dialog shows, which stays inline (see
 * `InsideDialog`). The toasts live in one store for the page and are shown by the
 * {@link Toaster} in the layout, beside the content rather than around it
 * (so the layout stays a server component), and they outlast the row, dialog
 * or page that caused them. An action that ends with a full page load
 * (`loadFresh`) leaves its toast for the next page with
 * {@link showToastAfterLoad}.
 */
'use client';

import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Toast } from 'radix-ui';
import { useEffect, useSyncExternalStore } from 'react';

import cn from '@/lib/cn';

import Button from './button';

/** Whether a toast reports a success or an error. */
export type ToastTone = 'success' | 'error';

/** Options for a toast. */
export interface ToastOptions {
  /** `success` (the default) or `error`. */
  tone?: ToastTone;
}

/** Shows a toast. */
export type ShowToast = (message: string, options?: ToastOptions) => void;

/** One toast on screen. */
interface ShownToast {
  /** Key, unique in this page. */
  id: number;
  /** The message. */
  message: string;
  /** Success or error. */
  tone: ToastTone;
}

/**
 * How long a toast stays, in milliseconds. Radix pauses the timer while the
 * toast is hovered or focused and while the window isn't, so there's time to
 * read it (WCAG 2.2.1); errors stay longer.
 */
const TOAST_DURATIONS: Record<ToastTone, number> = { success: 6000, error: 10000 };

/** How many toasts show at once; a new one replaces the oldest. */
const MAX_TOASTS = 3;

/** Icon and classes per tone. */
const tones = {
  success: { icon: CircleCheck, iconClass: 'text-success' },
  error: { icon: CircleAlert, iconClass: 'text-danger' },
} as const;

/** The toasts on screen, newest last. */
let shownToasts: readonly ShownToast[] = [];

/** How many {@link Toaster}s are mounted: toasts are only offered while one is. */
let mountedToasters = 0;

/** The last toast's ID. */
let lastId = 0;

/** Components to tell when the toasts or the toasters change. */
const listeners = new Set<() => void>();

/** Tells every subscriber that something changed. */
function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Subscribes to changes of the toasts or the toasters.
 *
 * @param listener - Called on every change.
 * @returns A function that unsubscribes.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shows a toast in the mounted {@link Toaster}.
 *
 * @param message - What happened.
 * @param options - Options.
 * @param options.tone - `success` (the default) or `error`.
 */
const showToast: ShowToast = (message, { tone = 'success' } = {}) => {
  lastId += 1;
  shownToasts = [...shownToasts.slice(-(MAX_TOASTS - 1)), { id: lastId, message, tone }];
  notify();
};

/** Where {@link showToastAfterLoad} leaves a toast for the next page, in the tab's `sessionStorage`. */
const AFTER_LOAD_KEY = 'adiutor.toast-after-load';

/**
 * How long a toast left for the next page counts, in milliseconds: long
 * enough for the page to load, short enough that a later page (or the next
 * person on the browser, should the next page not show it) never does.
 */
const AFTER_LOAD_MAX_AGE = 30_000;

/**
 * Leaves a success toast for the next page this tab loads, for an action
 * that ends with a full page load (`loadFresh`), which takes the toasts on
 * screen with it: e.g. "You're back in your own account." The next
 * {@link Toaster} shows it once, if it arrives within 30 seconds. It's kept
 * in the tab's `sessionStorage`; without storage (blocked site data), the
 * page loads without it.
 *
 * @param message - What happened.
 */
export function showToastAfterLoad(message: string): void {
  try {
    window.sessionStorage.setItem(AFTER_LOAD_KEY, JSON.stringify({ message, at: Date.now() }));
  } catch {
    // Without storage, there's just no toast after the load.
  }
}

/**
 * Takes the toast left for this page by {@link showToastAfterLoad}, removing
 * it, if it's recent enough.
 *
 * @returns Its message, or `null` without a recent one.
 */
function takeToastAfterLoad(): string | null {
  try {
    const saved = window.sessionStorage.getItem(AFTER_LOAD_KEY);
    if (saved === null) {
      return null;
    }
    window.sessionStorage.removeItem(AFTER_LOAD_KEY);
    const left: unknown = JSON.parse(saved);
    if (
      typeof left !== 'object' ||
      left === null ||
      !('message' in left) ||
      !('at' in left) ||
      typeof left.message !== 'string' ||
      typeof left.at !== 'number'
    ) {
      return null;
    }
    const age = Date.now() - left.at;
    return age >= 0 && age <= AFTER_LOAD_MAX_AGE ? left.message : null;
  } catch {
    return null;
  }
}

/**
 * Removes a toast once it closes (timed out, dismissed or swiped away).
 *
 * @param id - The toast.
 */
function removeToast(id: number): void {
  shownToasts = shownToasts.filter((toast) => toast.id !== id);
  notify();
}

/**
 * Returns the function that shows a toast, or `null` while no
 * {@link Toaster} is mounted: on the signed-out pages (results stay inline
 * there), on the server, and while the page hydrates.
 *
 * @returns `showToast`, or `null`.
 */
export function useToast(): ShowToast | null {
  const available = useSyncExternalStore(
    subscribe,
    () => mountedToasters > 0,
    () => false,
  );
  return available ? showToast : null;
}

/**
 * Shows the toasts at the bottom right (bottom centre on phones), in a
 * region named "Notifications (F8)" that F8 jumps to, in the reader's
 * language (Radix's own names are English). A success is announced to screen
 * readers as the result of what the user just did, after the word
 * "Notification". An error's text isn't announced again, because the inline
 * error next to the field or button already is, or takes focus: its toast
 * announces "Notification" and the one word "Error" in its place, so the
 * announcement says what appeared instead of the bare word "Notification".
 * That one is polite (Radix's `background` type): it waits for the inline
 * error a screen reader is reading out instead of cutting it off, while a
 * success is announced at once.
 * Each toast has a dismiss button and can be swiped away. Put one in a
 * layout, next to its content; toasts are offered while it's mounted, and
 * cleared when the last one goes. Once mounted, it shows the toast an action
 * left for this page ({@link showToastAfterLoad}).
 *
 * @returns The toasts.
 */
export function Toaster() {
  const t = useTranslations('common.actions');
  const tNotifications = useTranslations('common.notifications');
  const toasts = useSyncExternalStore(
    subscribe,
    () => shownToasts,
    () => shownToasts,
  );

  useEffect(() => {
    mountedToasters += 1;
    notify();
    // A moment later, so a mount that's undone at once (React's Strict Mode) doesn't use it up.
    const afterLoad = window.setTimeout(() => {
      const left = takeToastAfterLoad();
      if (left !== null) {
        showToast(left);
      }
    }, 0);
    return () => {
      window.clearTimeout(afterLoad);
      mountedToasters -= 1;
      if (mountedToasters === 0) {
        shownToasts = [];
      }
      notify();
    };
  }, []);

  return (
    // The label starts every announcement: "Notification Name saved."
    <Toast.Provider swipeDirection="right" label={tNotifications('label')}>
      {toasts.map(({ id, message, tone }) => {
        const { icon: Icon, iconClass } = tones[tone];
        return (
          <Toast.Root
            key={id}
            // An error waits its turn (polite), so it can't cut off the inline error being read out.
            type={tone === 'error' ? 'background' : 'foreground'}
            duration={TOAST_DURATIONS[tone]}
            onOpenChange={(open) => {
              if (!open) {
                removeToast(id);
              }
            }}
            data-tone={tone}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-raised px-3 py-2.5 text-sm text-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:animate-slide-in data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)"
          >
            <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', iconClass)} />
            {/* An error is announced where it's shown inline; the toast is for the eyes, and
                says only "Error" after the label. The attributes are Radix's own markers for
                text left out of its announcement and what to say instead (its `AnnounceExclude`,
                which it doesn't export); toast.test.tsx checks they still work. */}
            <div
              className="min-w-0 flex-1"
              data-radix-toast-announce-exclude={tone === 'error' ? '' : undefined}
              data-radix-toast-announce-alt={tone === 'error' ? tNotifications('error') : undefined}
            >
              <Toast.Description>{message}</Toast.Description>
            </div>
            <Toast.Close asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('dismissNotification')}
                className="-my-1.5 -mr-1.5 text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden="true" />
              </Button>
            </Toast.Close>
          </Toast.Root>
        );
      })}
      <Toast.Viewport
        // Radix puts the key that jumps here (F8) where the name says `{hotkey}`.
        label={tNotifications('region', { hotkey: '{hotkey}' })}
        className="fixed inset-x-0 bottom-0 z-60 mx-auto flex w-full max-w-sm flex-col gap-2 p-4 outline-none sm:right-0 sm:left-auto sm:mx-0"
      />
    </Toast.Provider>
  );
}
