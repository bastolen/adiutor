/**
 * @file The re-verify marker of "Confirm with GitHub" on the step-up page.
 * That button is a whole new sign-in with the provider, and Better Auth
 * ignores who is signed in, so the sign-in is marked as a re-verify of the
 * browser's session where the browser can't change it: in the server-side
 * part of Better Auth's OAuth state (`serverContext`, stored in the database
 * with the state). It's set before `/sign-in/social` (`beforeAuthRequest` in
 * `auth-guards/`, {@link markReverify}) and read back during that sign-in's
 * callback (`auth-events/`, {@link currentReverify}), which then only lets
 * the user's own confirmed account of the provider answer it
 * (`mayReverifyWith`), and gives the new session the confirmation the
 * marked session had until the provider's 2FA confirms it afresh
 * (`beforeSessionCreate`).
 */
import { addOAuthServerContext, getOAuthState } from 'better-auth/api';

import { isMfaProvider, REVERIFY_HINT } from '@/lib/sign-in/oauth-providers';

import { type SessionCookieContext, signedSession } from './signed-session';

/** The key of the marker in the OAuth state's `serverContext`. */
const MARKER_KEY = 'reverify';

/** A re-verify: who started it, and the session it confirms. */
export interface ReverifyMarker {
  /** The re-verifying user. */
  userId: string;
  /** The browser's session when it started, which it confirms. */
  sessionId: string;
}

/** The parts of the `/sign-in/social` endpoint context {@link markReverify} reads. */
interface ReverifyStartContext extends SessionCookieContext {
  /** Request body: the provider, and the browser's `additionalData`. */
  body?: Record<string, unknown> | null;
}

/**
 * Checks whether a sign-in's body carries the step-up page's hint
 * (`REVERIFY_HINT` set to `true` in `additionalData`).
 *
 * @param body - The `/sign-in/social` request body.
 * @returns Whether it asks for a re-verify.
 */
function hasReverifyHint(body: Record<string, unknown> | null | undefined): boolean {
  const data = body?.additionalData;
  return (
    typeof data === 'object' &&
    data !== null &&
    Object.hasOwn(data, REVERIFY_HINT) &&
    (data as Record<string, unknown>)[REVERIFY_HINT] === true
  );
}

/**
 * Marks a sign-in with a provider that can prove MFA as a re-verify, before
 * Better Auth handles `/sign-in/social`: when the browser sent the step-up
 * page's hint and has a live session (read from its validly signed session
 * cookie, `signedSession`, never with `getSessionFromCtx`, which would leave
 * the session in the request's context). The hint only narrows what the
 * sign-in may do: without it, or without a live session, it's a plain
 * sign-in with the provider, which the sign-in page allows anyway.
 *
 * @param ctx - The `/sign-in/social` endpoint context.
 */
export async function markReverify(ctx: ReverifyStartContext): Promise<void> {
  if (!hasReverifyHint(ctx.body) || !isMfaProvider(ctx.body?.provider)) {
    return;
  }
  const current = await signedSession(ctx);
  if (!current) {
    return;
  }
  await addOAuthServerContext({
    [MARKER_KEY]: { userId: current.userId, sessionId: current.id } satisfies ReverifyMarker,
  });
}

/**
 * Reads the re-verify marker of the OAuth sign-in this request belongs to
 * (Better Auth's `getOAuthState`, during the provider's callback).
 *
 * @returns The marker, or `null` for any other request (or outside one).
 */
export async function currentReverify(): Promise<ReverifyMarker | null> {
  let marker: unknown;
  try {
    marker = (await getOAuthState())?.serverContext?.[MARKER_KEY];
  } catch {
    // Outside a Better Auth request (e.g. a script) there's no OAuth state.
    return null;
  }
  if (typeof marker !== 'object' || marker === null) {
    return null;
  }
  const { userId, sessionId } = marker as Record<string, unknown>;
  return typeof userId === 'string' && typeof sessionId === 'string' ? { userId, sessionId } : null;
}
