/**
 * @file Next's `instrumentation` convention, on the Node.js runtime only:
 * `register` runs once when the server starts and makes every server log
 * line drop database values (`src/lib/log-redaction.ts`), including Next's
 * own logging of errors that pages, route handlers and server actions
 * throw, and in development it warns when the database is missing
 * migrations from `drizzle/` (`src/server/migration-check.ts`) and runs the
 * background jobs' tick every minute (`startDevTick`);
 * `onRequestError` records each of those errors in `app_error`
 * (`src/server/request-errors.ts`), under the reference the error page shows.
 */
import type { Instrumentation } from 'next';

/**
 * Sets up the server process before it handles requests: makes its logs
 * drop database values and, in development, starts checking the database
 * for pending migrations and ticking the background jobs. Neither is
 * awaited, since Next waits for `register` before serving requests and a
 * slow or unreachable database must not hold that up; each logs what it
 * finds and never fails startup.
 *
 * @returns Nothing, once it's set up.
 */
export async function register(): Promise<void> {
  // A block rather than an early return, so other runtimes' bundles leave the database code out.
  // eslint-disable-next-line no-restricted-properties -- Next.js replaces NEXT_RUNTIME per runtime at build time; importing `env` would load the configuration into every runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installLogRedaction } = await import('./lib/log-redaction');
    installLogRedaction();
    // eslint-disable-next-line no-restricted-properties -- Next.js sets NODE_ENV and replaces it at build time, before anything here imports `env`.
    if (process.env.NODE_ENV === 'development') {
      void import('./server/migration-check')
        .then(({ checkMigrations }) => checkMigrations())
        .catch(() => {
          // checkMigrations reports its own failures; nothing here may affect startup.
        });
      // Nothing calls the jobs' endpoint locally: the dev server ticks itself, every minute.
      void import('./server/jobs')
        .then(({ startDevTick }) => startDevTick())
        .catch(() => {
          // startDevTick logs a failed tick itself; nothing here may affect startup.
        });
    }
  }
}

/**
 * Records an error a page, server action, route handler or the proxy threw
 * on the server, with who was signed in. Best effort, and it never throws:
 * Next has logged the error already, so when recording fails (e.g. the
 * database is down) nothing more is done.
 *
 * @param error - The thrown value.
 * @param request - The request's path, method and headers.
 * @param context - Where it happened: the route type and path.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // A block rather than an early return, so other runtimes' bundles leave the database code out.
  // eslint-disable-next-line no-restricted-properties -- Next.js replaces NEXT_RUNTIME per runtime at build time; importing `env` would load the configuration into every runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { default: recordRequestError } = await import('./server/request-errors');
      await recordRequestError(error, request, context);
    } catch {
      // Recording is best effort; the error itself is in the log already.
    }
  }
};
