/**
 * @file Scaffolding shared by the integration tests that drive Better Auth's
 * real handler (`auth.handler`): a JSON request to one of its endpoints, a
 * cookie jar and a browser built on it, waiting for the emails it sends after
 * its responses, and checking that nobody holds a user's sign-in change lock.
 * It has no test context of its own: the test file creates it with
 * `setupTestContext()` and mocks `@/lib/email` (`sendEmail`).
 */
import { vi } from 'vitest';

import type { Database } from '@/db';
import { auth } from '@/lib/auth';
import { defined } from '@/lib/defined';
import { type Email, sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

import { releaseSignInChangeLock, takeSignInChangeLock } from './sign-in-change-lock';

/**
 * Sends a JSON `POST` to a Better Auth endpoint, as the app's pages do: from
 * the app's own origin, which Better Auth checks.
 *
 * @param path - The endpoint, e.g. `sign-in/email`.
 * @param options - Optional details.
 * @param options.body - The JSON body; empty by default.
 * @param options.headers - More request headers, e.g. the language cookie or a `user-agent`.
 * @param options.cookie - The `Cookie` header to send, if any.
 * @returns The response.
 */
export function authRequest(
  path: string,
  {
    body = {},
    headers = {},
    cookie,
  }: { body?: Record<string, unknown>; headers?: Record<string, string>; cookie?: string } = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: env.BETTER_AUTH_URL,
        ...headers,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * The cookies of a browser: it keeps the ones responses set, drops the ones
 * they expire (an empty value, or `Max-Age=0`), and sends them with requests.
 *
 * @returns The jar.
 */
export function cookieJar() {
  const cookies = new Map<string, string>();

  return {
    /**
     * The cookies it sends.
     *
     * @returns A `Cookie` header.
     */
    cookie: () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),

    /**
     * Keeps the cookies a response sets, and drops the ones it expires.
     *
     * @param response - The response.
     */
    keep(response: Response): void {
      response.headers.getSetCookie().forEach((set) => {
        const [first, ...attributes] = set.split(';');
        const pair = defined(first, 'the cookie name and value');
        const name = pair.slice(0, pair.indexOf('=')).trim();
        const value = pair.slice(pair.indexOf('=') + 1);
        const expired =
          value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
        if (expired) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      });
    },

    /**
     * Forgets cookies, as when a session cookie expires.
     *
     * @param name - Which cookies, by name.
     */
    forget(name: RegExp): void {
      [...cookies.keys()].filter((key) => name.test(key)).forEach((key) => cookies.delete(key));
    },

    /**
     * Copies cookies, as someone who got hold of them would.
     *
     * @param name - Which cookies, by name.
     * @returns Their names and values.
     */
    copy(name: RegExp): [string, string][] {
      return [...cookies].filter(([key]) => name.test(key));
    },

    /**
     * Sends copied cookies again from now on, as a browser holding a copy would.
     *
     * @param copied - Cookies from `copy`.
     */
    restore(copied: [string, string][]): void {
      copied.forEach(([key, value]) => cookies.set(key, value));
    },
  };
}

/**
 * A browser talking to Better Auth: a {@link cookieJar} that sends its
 * cookies with every request it makes.
 *
 * @param headers - More headers it sends with every request, e.g. its `user-agent`.
 * @returns The browser.
 */
export function newBrowser(headers: Record<string, string> = {}) {
  const jar = cookieJar();

  return {
    ...jar,

    /**
     * Sends a request to a Better Auth endpoint, keeping the cookies the response sets.
     *
     * @param path - The endpoint, e.g. `sign-in/email`.
     * @param body - The JSON body.
     * @returns The response.
     */
    async post(path: string, body: Record<string, unknown> = {}): Promise<Response> {
      const response = await authRequest(path, { body, headers, cookie: jar.cookie() });
      jar.keep(response);
      return response;
    },
  };
}

/**
 * Waits for emails that are sent after a response, which the tests watch
 * through the mocked `sendEmail`.
 *
 * @param count - How many matching emails to wait for.
 * @param what - What the emails are, for the message when they never come.
 * @param match - Which emails count; every one by default.
 * @returns The matching emails sent so far, in order.
 */
export async function sentEmails(
  count: number,
  what: string,
  match: (email: Email) => boolean = () => true,
): Promise<Email[]> {
  // Rendering the first email can take a moment.
  return vi.waitFor(() => {
    const found = vi
      .mocked(sendEmail)
      .mock.calls.map(([email]) => email)
      .filter(match);
    if (found.length < count) {
      throw new Error(`${what} has not been sent yet`);
    }
    return found;
  }, 10_000);
}

/**
 * Waits for one email that is sent after a response.
 *
 * @param what - What the email is, for the message when it never comes.
 * @param match - Which emails count; every one by default.
 * @returns The first matching email.
 */
export async function sentEmail(
  what: string,
  match: (email: Email) => boolean = () => true,
): Promise<Email> {
  return defined((await sentEmails(1, what, match))[0], what);
}

/**
 * Checks that nobody holds the user's sign-in change lock, by taking it and
 * giving it back.
 *
 * @param db - Test database.
 * @param userId - The user.
 * @returns Whether it was free.
 */
export async function signInChangeLockFree(db: Database, userId: string): Promise<boolean> {
  const lock = await takeSignInChangeLock({ db }, userId);
  if (!lock) {
    return false;
  }
  await releaseSignInChangeLock({ db }, lock);
  return true;
}
