/**
 * @file Keeps keyboard focus somewhere sensible when a control's own action
 * removes it: a row action whose row goes, or a button that swaps for
 * another ("Make staff" becoming "Remove staff access"). Shared by
 * `RowAction` and `ActionDialog`.
 */
'use client';

import { type RefObject, useLayoutEffect, useRef } from 'react';

import restoreFocusIfLost from './focus-fallback';

/**
 * Moves focus to the control's card heading (or the main content) when the
 * control goes away after its action worked and focus was left on nothing
 * (`restoreFocusIfLost`). The control sets the returned ref once its action
 * worked: the refresh that follows may unmount it, and the clean-up then
 * moves focus. A control that goes for any other reason (the user left the
 * page) leaves focus alone.
 *
 * @param containerRef - What holds the control (its form or wrapper), read when it mounts.
 * @returns The ref to set to `true` once the action worked.
 */
export default function useFocusAfterSuccess(
  containerRef: RefObject<Element | null>,
): RefObject<boolean> {
  // Set once the action worked, so the control going away afterwards can move focus.
  const succeeded = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    return () => {
      // The action removed the control (or swapped it): don't leave focus on <body>.
      if (succeeded.current) {
        succeeded.current = false;
        restoreFocusIfLost(container);
      }
    };
  }, [containerRef]);

  return succeeded;
}
