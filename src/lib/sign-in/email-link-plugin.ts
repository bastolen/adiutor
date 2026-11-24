/**
 * @file Better Auth's endpoint for the "Continue signing in" on a sign-in
 * email's confirmation page (`/auth/email-link`, decision 0041): `POST
 * /magic-link/verify`, a form no link can send, next to Better Auth's own
 * `GET` of the same path, which the guards send to that page whatever its
 * headers. Whether a `POST` is the page's own Continue is decided before it
 * gets here (`confirmSignInLinkFirst` in `src/server/auth/auth-guards/`), as
 * are its return addresses (`isSafeAppRedirect`). Sharing the path keeps
 * everything that knows the email link by it as it was: the sign-in recorded
 * as one (`email_link`), the "Last used" method, Better Auth's rate limit,
 * and the other tabs told after the redirect.
 *
 * It uses the link with Better Auth's own handler of the `GET`
 * (`magicLinkVerify`), called as a plain function, which runs no hooks a
 * second time, so it signs in exactly as the link always did: the link used
 * up, every session hook run (deactivated accounts refused, the previous
 * session in the browser ended, the sign-in recorded), the session cookie
 * set, and the browser sent to the return address, or to the error address
 * when the link can't be used. Its redirect is answered with a 303, so the
 * browser opens the next page with a `GET`.
 *
 * Like `src/lib/auth.ts`, it doesn't import `server-only`.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, formCsrfMiddleware, isAPIError } from 'better-auth/api';
import type { magicLink } from 'better-auth/plugins';
import { z } from 'zod';

import { DEFAULT_SIGNED_IN_PATH } from '../redirect';
import { MAGIC_LINK_ENDPOINT } from './email-link';

/** Better Auth's own handler of a sign-in link (`GET /magic-link/verify`). */
export type MagicLinkVerify = ReturnType<typeof magicLink>['endpoints']['magicLinkVerify'];

/** A return address in the form: a page of the app (checked by the guards). */
const returnAddress = z.string().max(2048).optional();

/**
 * The confirmation page's Continue: the link's token and the return
 * addresses the page passes on (`EMAIL_LINK_PARAMS`).
 */
const continueSchema = z.object({
  token: z.string().max(256),
  callbackURL: returnAddress,
  errorCallbackURL: returnAddress,
  newUserCallbackURL: returnAddress,
});

/**
 * The plugin with the confirmation page's Continue.
 *
 * @param verify - Better Auth's own handler of the link, from the magic-link plugin's endpoints.
 * @returns The plugin.
 */
export default function emailLinkContinue(verify: MagicLinkVerify) {
  return {
    id: 'adiutor-email-link',
    endpoints: {
      emailLinkContinue: createAuthEndpoint(
        MAGIC_LINK_ENDPOINT,
        {
          method: 'POST',
          body: continueSchema,
          requireHeaders: true,
          // Better Auth's check for sign-in forms: it refuses another site's form (a cross-site
          // navigation) and checks the origin also when the browser sends no cookies.
          use: [formCsrfMiddleware],
          // The confirmation page's plain form.
          metadata: { allowedMediaTypes: ['application/x-www-form-urlencoded'] },
        },
        /**
         * Uses the link with Better Auth's handler and passes its redirect on.
         * Better Auth answers with JSON (the session's token in it) instead
         * of a redirect when `callbackURL` is missing or empty, so one always
         * goes: the page always sends it, and a missing or empty one gets the
         * dashboard (the guards refuse an empty one already; this doesn't
         * rely on them).
         *
         * @param ctx - The endpoint context.
         * @returns Nothing: the response is a 303 to the next page.
         * @throws {APIError} Better Auth's refusals other than its redirect.
         */
        async (ctx) => {
          const { token, callbackURL, errorCallbackURL, newUserCallbackURL } = ctx.body;
          let redirect: APIError | null = null;
          try {
            await verify({
              context: ctx.context,
              headers: ctx.headers,
              request: ctx.request,
              query: {
                token,
                callbackURL: callbackURL || DEFAULT_SIGNED_IN_PATH,
                errorCallbackURL,
                newUserCallbackURL,
              },
            });
          } catch (error) {
            if (!isAPIError(error) || error.statusCode !== 302) {
              throw error;
            }
            redirect = error;
          }
          const headers = new Headers(redirect?.headers);
          const location = headers.get('location');
          if (!location) {
            throw new APIError('INTERNAL_SERVER_ERROR');
          }
          headers.getSetCookie().forEach((cookie) => {
            ctx.responseHeaders.append('set-cookie', cookie);
          });
          ctx.setHeader('location', location);
          ctx.setStatus(303);
          return null;
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
