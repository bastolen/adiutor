/**
 * @file State that resets when the user leaves the page, and what a page
 * does once per visit.
 *
 * With Cache Components, Next.js keeps recently visited pages alive with
 * React's `<Activity>` instead of unmounting them, so their state survives
 * navigation. That's right for drafts, but not for messages about something
 * that just happened ("Name saved.") or for open dialogs: coming back to the
 * page should show it fresh. When `<Activity>` hides a page it runs layout
 * effect cleanups, which is where these hooks reset. What a page does once
 * when it opens (emailing a code) it should do again when the user comes back
 * to it: `useOncePerVisit` runs it once each time the page is shown.
 *
 * React 19 also resets a `<form action>` after every submit, whatever the
 * result, so a refused submit would wipe what the user typed.
 * `useTransientActionState`'s `onSubmit` runs the action itself instead, and
 * clears the form only after a successful result.
 */
'use client';

import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/**
 * Like `useState`, but goes back to its initial value when the page is
 * hidden (the user navigated away). Use it for status messages and the open
 * state of dialogs.
 *
 * @param initialState - The value to start with and reset to.
 * @returns The value and its setter.
 */
export function useTransientState<T>(initialState: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initialState);
  const [initial] = useState(initialState);

  useLayoutEffect(() => () => setValue(() => initial), [initial]);

  return [value, setValue];
}

/**
 * Runs something once each time the page is shown: when it opens, and again
 * when the user comes back to it after it was hidden (pages stay alive in
 * `<Activity>`, which runs their effects again when it shows them). Use it
 * for what a page does by itself on opening, such as emailing a code: coming
 * back is a new visit, often for something new (a new sign-in), so doing it
 * once in the page's life isn't enough.
 *
 * It runs once per visit also in React's Strict Mode, which (in development)
 * cleans every effect up and sets it up again right after showing a page, to
 * check that effects can take it. So a note that it ran can't be state (the
 * second run would still see the first render's value), nor a ref reset in
 * the clean-up (it would be reset between the two runs). The clean-up only
 * notes that the page went, and a microtask forgets that it ran if the page
 * is still gone a moment later: Strict Mode sets the effects up again in the
 * same breath, before any microtask runs, while a page that `<Activity>`
 * hides stays hidden.
 *
 * @param run - What to do; the latest one given is the one that runs.
 */
export function useOncePerVisit(run: () => void): void {
  // Whether it ran during this visit of the page.
  const ran = useRef(false);
  // Whether the page is shown: its layout effects are set up.
  const shown = useRef(false);
  const runLatest = useEffectEvent(run);

  useLayoutEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
      queueMicrotask(() => {
        if (!shown.current) {
          ran.current = false;
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!ran.current) {
      ran.current = true;
      runLatest();
    }
  }, []);
}

/** Options for {@link useTransientActionState}. */
export interface TransientActionStateOptions {
  /**
   * Whether to clear the submitted form once a result with `ok: true` arrives,
   * as React does after every submit. Defaults to `true`; a refused submit
   * always keeps what was typed.
   */
  resetOnSuccess?: boolean;
}

/**
 * Checks whether an action's result says it went through (`{ ok: true }`,
 * as `ActionResult` does).
 *
 * @param state - The result.
 * @returns Whether it's a successful result.
 */
function isSuccess(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'ok' in state && state.ok === true;
}

/**
 * Reads a submitted form's data, including the button that submitted it
 * (its `name` and `value`), as the browser would send it.
 *
 * @param form - The form.
 * @param submitter - The button that submitted it, if any.
 * @returns The form data.
 */
function submittedData(form: HTMLFormElement, submitter: HTMLElement | null): FormData {
  try {
    return new FormData(form, submitter);
  } catch {
    // Older browsers and test DOMs without the `submitter` argument.
    const data = new FormData(form);
    if (submitter instanceof HTMLButtonElement && submitter.name) {
      data.append(submitter.name, submitter.value);
    }
    return data;
  }
}

/**
 * Like `useActionState`, but forgets the result shown when the page is
 * hidden (the user navigated away), so coming back doesn't show an old
 * "Saved" or error message. The next submission shows its result as usual.
 * Typed input stays.
 *
 * Pass both the action and `onSubmit` to the form:
 * `<form action={formAction} onSubmit={onSubmit}>`. `onSubmit` runs the
 * action itself, so React doesn't reset the form: a refused submit keeps
 * everything typed (React 19 resets a `<form action>` whatever the result).
 * After a successful one, the form is cleared as before, unless
 * `resetOnSuccess` is `false`. The `action` still works before JavaScript
 * has loaded.
 *
 * @param action - The (server) action to run, with the form's data.
 * @param initialState - The state before the first submission, e.g. `null`.
 * @param options - Options.
 * @param options.resetOnSuccess - Whether to clear the form after a successful result (default `true`).
 * @returns The current result (or `initialState` once it has gone stale), the
 *   function to pass to `<form action>`, whether it's running, and the
 *   `onSubmit` handler to pass to the form.
 */
export function useTransientActionState<State, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  { resetOnSuccess = true }: TransientActionStateOptions = {},
): [
  state: Awaited<State>,
  dispatch: (payload: Payload) => void,
  isPending: boolean,
  onSubmit: (event: FormEvent<HTMLFormElement>) => void,
] {
  const [state, dispatch, isPending] = useActionState(action, initialState);
  // The result that was on screen when the page was last hidden.
  const [stale, setStale] = useState<{ state: Awaited<State> } | null>(null);
  const latest = useRef(state);
  // The form submitted last, until its result arrives.
  const submitted = useRef<HTMLFormElement | null>(null);

  useLayoutEffect(() => {
    if (latest.current !== state && submitted.current) {
      if (resetOnSuccess && isSuccess(state)) {
        submitted.current.reset();
      }
      submitted.current = null;
    }
    latest.current = state;
  }, [state, resetOnSuccess]);
  useLayoutEffect(() => () => setStale({ state: latest.current }), []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
      submitted.current = form;
      startTransition(() => dispatch(submittedData(form, submitter) as Payload));
    },
    [dispatch],
  );

  return [stale && stale.state === state ? initialState : state, dispatch, isPending, onSubmit];
}
