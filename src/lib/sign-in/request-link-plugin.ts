/**
 * @file Better Auth's endpoint for the link in an email about a request
 * (decision 0036, `src/lib/sign-in/request-link.ts`): `GET
 * /request-link/sign-in?token=…`, the email's link, and `POST
 * /request-link/sign-in`, its confirmation page's Continue (a form, which no
 * link can send). What the link may do is decided by the app
 * (`followRequestLink` in `src/server/auth/request-links.ts`, loaded on first
 * use so `pnpm auth:schema` doesn't load it); this file only creates the
 * session the way Better Auth's own magic-link plugin does, so every session
 * hook runs (deactivated accounts refused, the previous session in the
 * browser ended, the sign-in recorded) and the browser lands on the request
 * with a full page load.
 *
 * Like `src/lib/auth.ts`, it doesn't import `server-only`.
 */
import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { createAuthEndpoint, formCsrfMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

import { REQUEST_LINK_ENDPOINT } from './request-link';

/**
 * Loads the app's rules for request links on first use, like the auth
 * events in `src/lib/auth.ts`.
 *
 * @returns The `src/server/auth/request-links.ts` module.
 */
function loadRequestLinks() {
  return import('../../server/auth/request-links');
}

/**
 * The link's fields: its token and the entry it points at (checked as an
 * entry's ID where it's used); the email's link has them in its query, the
 * confirmation page's Continue in its form.
 */
const requestLinkSchema = z.object({
  token: z.string().max(256),
  entry: z.string().max(64).optional(),
});

/**
 * The confirmation page's Continue: the link's fields, and `auto=1` when the
 * page sent it by itself (decision 0038).
 */
const continueSchema = requestLinkSchema.extend({ auto: z.string().max(8).optional() });

/** What the endpoints hand {@link followLink}. */
interface FollowedLink {
  /** The link's token. */
  token: string;
  /** The entry it points at, if any. */
  entry?: string;
  /** Whether the browser posted it: only the confirmation page's Continue does. */
  posted: boolean;
  /** Whether the page sent its Continue by itself. */
  auto?: boolean;
}

/**
 * Signs the link's person in when the app says so, then sends the browser
 * on: to the request, the confirmation page or the sign-in page. A link
 * (`GET`) is redirected with a 302, as Better Auth does; the page's form
 * (`POST`) with a 303, so the browser opens the next page with a `GET`.
 *
 * @param ctx - The endpoint context.
 * @param link - The link, and how it came.
 * @returns Nothing, for a POST (its 303 is set on the context).
 * @throws {APIError} A link's redirect.
 */
async function followLink(ctx: GenericEndpointContext, link: FollowedLink): Promise<null> {
  const links = await loadRequestLinks();
  const outcome = await links.followRequestLink(ctx, {
    token: link.token,
    posted: link.posted,
    auto: link.auto ?? false,
    entry: link.entry ?? null,
  });
  /**
   * Sends the browser to a page of the app.
   *
   * @param path - The page.
   * @returns Nothing, for a POST.
   * @throws {APIError} A link's redirect.
   */
  const goTo = (path: string): null => {
    const location = new URL(path, ctx.context.baseURL).toString();
    if (!link.posted) {
      throw ctx.redirect(location);
    }
    ctx.setHeader('location', location);
    ctx.setStatus(303);
    return null;
  };
  if (outcome.signIn) {
    const found = await ctx.context.internalAdapter.findUserById(outcome.signIn.userId);
    const session = found ? await ctx.context.internalAdapter.createSession(found.id) : null;
    if (!found || !session) {
      return goTo(outcome.fallback);
    }
    await setSessionCookie(ctx, { session, user: found });
    await links.noteRequestLinkUsed(outcome.signIn.linkId);
  }
  return goTo(outcome.location);
}

/**
 * The plugin with the request link's endpoints. Better Auth's own rate limit
 * for them (per IP address) comes on top of the app's: a wrong token counts
 * against the IP address, and sign-ins against the link.
 *
 * @returns The plugin.
 */
export default function requestLinkSignIn() {
  return {
    id: 'adiutor-request-link',
    endpoints: {
      requestLinkSignIn: createAuthEndpoint(
        REQUEST_LINK_ENDPOINT,
        { method: 'GET', query: requestLinkSchema, requireHeaders: true },
        /**
         * The email's link. Anything else in its query, such as a `confirmed`
         * written into it, is ignored: only the page's form is its Continue.
         *
         * @param ctx - The endpoint context.
         * @returns Never: it always redirects.
         */
        async (ctx) => followLink(ctx, { ...ctx.query, posted: false }),
      ),
      requestLinkContinue: createAuthEndpoint(
        REQUEST_LINK_ENDPOINT,
        {
          method: 'POST',
          body: continueSchema,
          requireHeaders: true,
          // Better Auth's check for sign-in forms: it refuses another site's form (a cross-site
          // navigation) and checks the origin also when the browser sends no cookies, which it
          // doesn't with another site's POST.
          use: [formCsrfMiddleware],
          // The confirmation page's plain form.
          metadata: { allowedMediaTypes: ['application/x-www-form-urlencoded'] },
        },
        /**
         * The confirmation page's Continue.
         *
         * @param ctx - The endpoint context.
         * @returns Nothing: the response is a 303 to the next page.
         */
        async (ctx) =>
          followLink(ctx, {
            token: ctx.body.token,
            entry: ctx.body.entry,
            posted: true,
            auto: ctx.body.auto === '1',
          }),
      ),
    },
    rateLimit: [
      {
        /**
         * Only this endpoint, whichever method.
         *
         * @param path - The endpoint path.
         * @returns Whether it's the request link's.
         */
        pathMatcher: (path: string) => path === REQUEST_LINK_ENDPOINT,
        window: 60,
        max: 20,
      },
    ],
  } satisfies BetterAuthPlugin;
}
