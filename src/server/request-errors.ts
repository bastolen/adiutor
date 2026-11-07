/**
 * @file Records the errors Next.js reports to `onRequestError`
 * (`src/instrumentation.ts`): pages, server actions, route handlers and the
 * proxy that threw on the server. It runs outside the request (there's no
 * `headers()`), so the IP address and the signed-in user are read from the
 * request headers Next passes along. Loaded only when an error happens, on
 * the Node.js runtime.
 */
import type { Instrumentation } from 'next';

import { db } from '@/db';
import { auth } from '@/lib/auth';
import { errorDigest } from '@/lib/error-reference';
import ipAddressOptions from '@/lib/request/ip-address-options';
import { requestInfoFromHeaders } from '@/lib/request/request-info';

import { recordAppError } from './app-errors';

/** What Next passes to `onRequestError`: the error, the request and where it happened. */
type RequestErrorArguments = Parameters<Instrumentation.onRequestError>;

/**
 * Turns the request headers Next passes along into `Headers`, leaving out
 * any it wouldn't accept.
 *
 * @param raw - The headers, each a value or a list of values.
 * @returns The headers.
 */
function toHeaders(raw: RequestErrorArguments[1]['headers']): Headers {
  const headers = new Headers();
  Object.entries(raw).forEach(([name, value]) => {
    [value ?? []].flat().forEach((item) => {
      try {
        headers.append(name, item);
      } catch {
        // Not a valid header: the rest still count.
      }
    });
  });
  return headers;
}

/**
 * Finds who was signed in from the session cookie, as best it can: an error
 * is recorded without a user rather than not at all.
 *
 * @param headers - The request headers.
 * @returns The user's ID, or `null` when signed out or when it can't be read.
 */
async function signedInUserId(headers: Headers): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Records an error the server reported, under the reference its digest
 * gives (the one the error page shows), with the request's path, the route
 * and who was signed in. Recording can fail (e.g. the database is down);
 * the caller catches that, since Next has logged the error already.
 *
 * @param error - The thrown value.
 * @param request - The request: its path (with the query string, taken out
 *   before storing) and headers.
 * @param context - Where it happened: the route type and path.
 */
export default async function recordRequestError(
  error: RequestErrorArguments[0],
  request: RequestErrorArguments[1],
  context: RequestErrorArguments[2],
): Promise<void> {
  const headers = toHeaders(request.headers);
  await recordAppError(
    {
      db,
      /**
       * Reads where the request came from, from its headers.
       *
       * @returns The IP address and browser.
       */
      requestInfo: async () => requestInfoFromHeaders(headers, ipAddressOptions),
    },
    {
      source: 'server',
      error,
      digest: errorDigest(error),
      routeType: context.routeType,
      routePath: context.routePath,
      path: request.path,
      userId: await signedInUserId(headers),
    },
  );
}
