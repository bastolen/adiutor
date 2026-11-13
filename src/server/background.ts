/**
 * @file Work a request starts but doesn't wait for, such as recording when
 * the signed-in user was last active (`getOptionalActor`).
 *
 * Not Next's `after()`: called while a page renders, `after()` ties itself to
 * that render, and once the response closes Next treats the whole render as
 * finished. A render can outlive its response (the browser moved on before
 * it was done, or Partial Prefetching cut a prefetch short), and a
 * `cookies()` or `headers()` read still to come in it, such as a page's title
 * reading the language, then fails with "used `cookies()` inside `after()`".
 * Work started here runs on its own instead. The price is that Next doesn't
 * wait for it when the server shuts down, so it's only for work that may be
 * lost or that a job catches up on.
 */
import 'server-only';

/**
 * Starts work without making the caller wait for it, and logs its failure.
 * The work must not read the request (`cookies()`, `headers()`), since it can
 * outlive the response: read what it needs first and pass it in.
 *
 * @param description - What the work does, for the log, e.g. "Recording when the user was last active".
 * @param task - The work.
 */
export default function startInBackground(description: string, task: () => Promise<unknown>): void {
  // Started from a promise, so a task that throws before returning one is logged too.
  void Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console -- Background work has no caller to report to; database values are left out by the log redaction.
      console.error(`${description} failed`, error);
    });
}
