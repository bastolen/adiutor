/**
 * @file Loads the page a saved preference sends the user to afresh, for the
 * forms whose change every page kept alive must show (the language, the time
 * zone): a soft refresh would leave those pages as they were.
 */
'use client';

import { useEffect } from 'react';

import type { ActionResult } from '@/lib/action-result';

import loadFresh from './load-fresh';

/**
 * Once an action's result says it worked and gives an address
 * (`result.data`), loads that address afresh (`loadFresh`), which also works
 * when the page is already at it after an earlier change. Until the page
 * goes, the form's button stays busy, so nobody presses it twice.
 *
 * @param result - The action's last result, or `null` before the first.
 * @returns Whether the page is on its way out: the save worked, and the fresh load has started.
 */
export default function useLoadFreshOnSuccess(result: ActionResult<string> | null): boolean {
  useEffect(() => {
    if (result?.ok && result.data) {
      loadFresh(result.data);
    }
  }, [result]);
  return Boolean(result?.ok);
}
