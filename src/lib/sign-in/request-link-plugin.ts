/**
 * @file Better Auth's endpoint for the link in an email about a request
 * (decision 0036, `src/lib/sign-in/request-link.ts`): `GET
 * /request-link/sign-in?token=…`. What the link may do is decided by the app
 * (`followRequestLink` in `src/server/auth/request-links.ts`, loaded on first
 * use so `pnpm auth:schema` doesn't load it); this file only creates the
 * session the way Better Auth's own magic-link plugin does, so every session
 * hook runs (deactivated accounts refused, the previous session in the
 * browser ended, the sign-in recorded) and the browser lands on the request
 * with a full page load.
 *
 * Like `src/lib/auth.ts`, it doesn't import `server-only`.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
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

/** The link's query: its token, and whether the confirmation page's Continue sent it. */
const requestLinkQuerySchema = z.object({
  token: z.string().max(256),
  confirmed: z.string().max(8).optional(),
});

/**
 * The plugin with the request link's endpoint. Better Auth's own rate limit
 * for it (per IP address) comes on top of the app's: a wrong token counts
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
        { method: 'GET', query: requestLinkQuerySchema, requireHeaders: true },
        /**
         * Signs the link's person in when the app says so, then sends the
         * browser on: to the request, or to the confirmation page.
         *
         * @param ctx - The endpoint context.
         * @returns Never: it always redirects.
         */
        async (ctx) => {
          const links = await loadRequestLinks();
          const outcome = await links.followRequestLink(ctx, {
            token: ctx.query.token,
            confirmed: ctx.query.confirmed === '1',
          });
          if (outcome.signIn) {
            const found = await ctx.context.internalAdapter.findUserById(outcome.signIn.userId);
            const session = found
              ? await ctx.context.internalAdapter.createSession(found.id)
              : null;
            if (!found || !session) {
              throw ctx.redirect(new URL(outcome.fallback, ctx.context.baseURL).toString());
            }
            await setSessionCookie(ctx, { session, user: found });
            await links.noteRequestLinkUsed(outcome.signIn.linkId);
          }
          throw ctx.redirect(new URL(outcome.location, ctx.context.baseURL).toString());
        },
      ),
    },
    rateLimit: [
      {
        /**
         * Only this endpoint.
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
