/**
 * @file Saves a select's value as soon as one is picked, for the selects that
 * save without a button: a person's role (`RoleSelect`) and a request's
 * status (`StatusSelect`). The select shows the picked value while it's
 * saved, and the saved one again once the result arrives; the outcome is a
 * toast in the signed-in app, shown as soon as the action returns, like
 * `RowAction`'s.
 */
'use client';

import { type FormEvent, type RefObject, startTransition, useCallback, useRef } from 'react';

import type { ActionResult } from '@/lib/action-result';

import { useToast } from './toast';
import { useTransientActionState, useTransientState } from './use-transient-state';

/** What a select that saves when a value is picked works with. */
export interface SaveOnPick {
  /** The form around the select, whose fields go with each save. */
  formRef: RefObject<HTMLFormElement | null>;
  /** The form's `action`, which also works before JavaScript has loaded. */
  formAction: (formData: FormData) => void;
  /** The form's `onSubmit` (`useTransientActionState`). */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** The last save's result, until the page is hidden. */
  result: ActionResult | null;
  /** Whether a save is running: the select is busy (focusable, not disabled). */
  pending: boolean;
  /** Whether the outcome is a toast (in the signed-in app, where a `Toaster` is mounted). */
  showsToast: boolean;
  /** The value the select shows: the one picked while it's saved, else the saved one. */
  shown: string;
  /** The value picked last (being confirmed or saved), or `null`. */
  picked: string | null;
  /**
   * Shows a picked value until a newer result arrives (the saved value comes
   * with it), without saving it yet, e.g. while a dialog asks first.
   *
   * @param value - The picked value.
   */
  pick: (value: string) => void;
  /** Forgets the picked value, e.g. when the dialog that asked was cancelled. */
  unpick: () => void;
  /**
   * Saves a value: the form's fields, with the select's field set to it.
   *
   * @param value - The value to save.
   */
  save: (value: string) => void;
}

/**
 * Saves a select's value when one is picked, with the form's other fields.
 *
 * @param action - The server action that saves it.
 * @param options - The select's field and its saved value.
 * @param options.name - The select's field, e.g. `role`.
 * @param options.saved - Its saved value, which the select shows when nothing is picked.
 * @returns What the select and its form work with.
 */
export default function useSaveOnPick(
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>,
  { name, saved }: { name: string; saved: string },
): SaveOnPick {
  const showToast = useToast();
  // Toasts as soon as the action returns, like `RowAction`.
  const run = useCallback(
    async (previous: ActionResult | null, formData: FormData) => {
      const next = await action(previous, formData);
      if (showToast && next.message) {
        showToast(next.message, { tone: next.ok ? 'success' : 'error' });
      }
      return next;
    },
    [action, showToast],
  );
  const [result, formAction, pending, onSubmit] = useTransientActionState(run, null);
  const formRef = useRef<HTMLFormElement>(null);
  // The value picked (being confirmed or saved), with the result it was picked after: once a newer
  // result arrives, the select shows the saved value again (the new one after a success, which
  // arrives with the result; the old one after a refusal).
  const [picked, setPicked] = useTransientState<{
    value: string;
    after: ActionResult | null;
  } | null>(null);

  /**
   * Saves a value: the form's fields with the select's field set to it.
   *
   * @param value - The value to save.
   */
  const save = (value: string) => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    const formData = new FormData(form);
    formData.set(name, value);
    startTransition(() => formAction(formData));
  };

  return {
    formRef,
    formAction,
    onSubmit,
    result,
    pending,
    showsToast: Boolean(showToast),
    shown: picked && picked.after === result ? picked.value : saved,
    picked: picked?.value ?? null,
    /**
     * Shows a picked value until a newer result arrives.
     *
     * @param value - The picked value.
     */
    pick: (value) => {
      setPicked({ value, after: result });
    },
    /** Forgets the picked value. */
    unpick: () => {
      setPicked(null);
    },
    save,
  };
}
