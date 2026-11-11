/**
 * @file The reference an error page shows, for the user to send to an
 * administrator (`ErrorReference`). Shared by the app's error pages
 * (`error.tsx`, `(app)/error.tsx` and `global-error.tsx`).
 */
'use client';

import { useEffect, useRef, useState } from 'react';

import { errorDigest, referenceFromDigest } from '@/lib/error-reference';
import {
  ERROR_MESSAGE_MAX_LENGTH,
  ERROR_NAME_MAX_LENGTH,
  ERROR_PATH_MAX_LENGTH,
} from '@/lib/input-rules';

import reportErrorAction, { type BrowserErrorReport } from './report-error-action';

/** A reference and when the error happened, as the reference box shows them. */
export interface ShownErrorReference {
  /** The reference, e.g. `7KQ2-M9XD`. */
  reference: string;
  /** When it happened. */
  at: Date;
}

/**
 * Describes an error that broke the page in the browser, for the report.
 * The name and message are cut to what the server accepts, and the path is
 * sent without its query string.
 *
 * @param error - The thrown value (not always an `Error`).
 * @returns The report.
 */
function browserReport(error: unknown): BrowserErrorReport {
  let message = '';
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    // A value that can't be turned into text: the report still says where it happened.
  }
  return {
    name: error instanceof Error ? error.name.slice(0, ERROR_NAME_MAX_LENGTH) : null,
    message: message.slice(0, ERROR_MESSAGE_MAX_LENGTH),
    path: window.location.pathname.slice(0, ERROR_PATH_MAX_LENGTH),
  };
}

/**
 * Works out the reference of the error an error page shows, once it's on
 * screen:
 *
 * - Errors from the server have a digest, and the server recorded them
 *   (`onRequestError`) under the reference it gives: the page works it out
 *   itself, with the browser's time as the moment.
 * - Errors in the browser have none: the page reports them once
 *   (`reportErrorAction`) and shows the reference and time that come back.
 *   When the report fails or is past the limit, there's no reference.
 *
 * @param error - The error the page got from Next.js.
 * @returns The reference and its time, or `null` while there's none (yet).
 */
export default function useErrorReference(error: unknown): ShownErrorReference | null {
  const [shown, setShown] = useState<{ error: unknown; reference: ShownErrorReference } | null>(
    null,
  );
  // The error last looked at, so it's reported once even when the effect runs again.
  const handled = useRef<{ error: unknown } | null>(null);

  useEffect(() => {
    if (handled.current && handled.current.error === error) {
      return;
    }
    handled.current = { error };
    const digest = errorDigest(error);
    const reference: Promise<ShownErrorReference | null> = digest
      ? Promise.resolve({ reference: referenceFromDigest(digest), at: new Date() })
      : reportErrorAction(browserReport(error));
    reference
      .then((found) => {
        if (found) {
          setShown({ error, reference: { reference: found.reference, at: new Date(found.at) } });
        }
      })
      .catch(() => {
        // The report failed: the page simply shows no reference.
      });
  }, [error]);

  return shown && shown.error === error ? shown.reference : null;
}
