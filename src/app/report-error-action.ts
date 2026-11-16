/**
 * @file Server action for the error pages: reports an error that broke a
 * page in the browser. Those have no digest, so the server never saw them;
 * this records them (`recordAppError`) and gives the page a reference to
 * show. Errors from the server are recorded by `onRequestError` instead
 * (`src/instrumentation.ts`), and the page works out their reference itself.
 */
'use server';

import { z } from 'zod';

import { hasControlCharacter } from '@/lib/character-rules';
import {
  ERROR_MESSAGE_MAX_LENGTH,
  ERROR_NAME_MAX_LENGTH,
  ERROR_PATH_MAX_LENGTH,
} from '@/lib/input-rules';
import appContext from '@/server/app-context';
import { type RecordedAppError, recordAppError } from '@/server/app-errors';
import { getOptionalActor } from '@/server/authz';

/**
 * What the error page sends: the error's class name (if it was an `Error`)
 * and message, and the page's path, whose query string and fragment are
 * dropped (they can hold search terms and tokens). A path with a control
 * character is refused: a browser's address never has one, and the path goes
 * into the server log, where a line break would start a line of its own
 * (anyone, signed out too, can call this action). The name and message are
 * only stored, on one line (`recordAppError`); an error's message may well
 * have line breaks.
 */
const reportSchema = z.object({
  name: z.string().max(ERROR_NAME_MAX_LENGTH).nullable(),
  message: z.string().max(ERROR_MESSAGE_MAX_LENGTH),
  path: z
    .string()
    .max(2048)
    .refine((path) => !hasControlCharacter(path))
    .transform((path) => path.split(/[?#]/, 1)[0] ?? '')
    .pipe(z.string().max(ERROR_PATH_MAX_LENGTH)),
});

/** An error the browser reports, as the error page sends it. */
export type BrowserErrorReport = z.input<typeof reportSchema>;

/**
 * Records an error that broke a page in the browser, with who is signed in,
 * if anyone. The same limit per IP address as the server's errors applies
 * (`RATE_LIMITS.appErrorsPerIp`).
 *
 * @param report - The error's name and message, and the page's path.
 * @returns The reference and when it was recorded, or `null` when the
 *   report is invalid, past the limit (it's only logged then), or couldn't
 *   be recorded: the page then shows no reference.
 */
export default async function reportErrorAction(
  report: BrowserErrorReport,
): Promise<RecordedAppError | null> {
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success) {
    return null;
  }
  try {
    const actor = await getOptionalActor().catch(() => null);
    const { name, message, path } = parsed.data;
    const recorded = await recordAppError(appContext, {
      source: 'browser',
      error: { name, message },
      path,
      // The person at the browser: a staff member signed in as someone is recorded as themselves,
      // like errors on the server (`recordRequestError`).
      userId: actor?.signedInAs?.staffId ?? actor?.id ?? null,
    });
    return recorded.stored ? { reference: recorded.reference, at: recorded.at } : null;
  } catch {
    // The database may be what's failing; the page simply shows no reference.
    return null;
  }
}
