/**
 * @file What a browser leaves behind when someone signs in or out there: its
 * trusted device, its previous session, the notice cookies that no longer
 * apply, and at sign-out what it kept in its cache.
 */
import { and, eq, ne } from 'drizzle-orm';

import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { cookiesToClearAtSignOut } from '@/lib/sign-in/auth-cookies';
import { PROVIDER_LINKED_COOKIE, PROVIDER_STEP_UP_COOKIE } from '@/lib/sign-in/oauth-providers';

import { requestState } from '../request-state';
import { signedSessionToken } from '../signed-session';
import { forgetTrustedDevice, trustedDeviceUser } from '../trusted-devices';
import { expireCookie, expireCookieIfSent } from './cookies';
import type { AuthHookContext } from './hook-context';

/** Better Auth's name for the trusted-device cookie ("Trust this device" at the code step). */
const TRUST_DEVICE_COOKIE = 'trust_device';

/**
 * Reads which trusted device a browser's trusted-device cookie names: the
 * identifier from its `<HMAC>!<identifier>` value, only when the cookie's
 * signature checks out with the auth secret.
 *
 * @param ctx - The endpoint context.
 * @returns The cookie's full name and the device's identifier, or `null`
 *   without a validly signed cookie.
 */
async function browserTrustedDevice(
  ctx: AuthHookContext,
): Promise<{ name: string; identifier: string } | null> {
  const name = ctx.context.createAuthCookie?.(TRUST_DEVICE_COOKIE).name;
  const { secret } = ctx.context;
  if (!name || !secret || !ctx.getSignedCookie) {
    return null;
  }
  const value = await ctx.getSignedCookie(name, secret);
  if (!value) {
    return null;
  }
  return { name, identifier: value.split('!')[1] ?? '' };
}

/**
 * Forgets the browser's "Trust this device" of someone other than the user
 * who just signed in, as signing out would have: the cookie is expired, and
 * its trusted device forgotten, so a copy of the cookie doesn't skip their
 * code step either. Better Auth's two-step plugin only drops it when the new
 * user has two-step verification on.
 *
 * @param ctx - The endpoint context.
 * @param userId - The user who just signed in, whose own trusted device stays.
 */
async function forgetOthersBrowserTrust(ctx: AuthHookContext, userId: string): Promise<void> {
  const device = await browserTrustedDevice(ctx);
  if (!device) {
    return;
  }
  if ((await trustedDeviceUser(db, device.identifier)) === userId) {
    return;
  }
  await forgetTrustedDevice(db, device.identifier);
  expireCookie(ctx, device.name);
}

/**
 * Forgets the trusted device of a browser that signs out, whoever's it is:
 * signing out expires its cookie ({@link clearCookiesAtSignOut}), and this
 * forgets the device itself, so a copy of the cookie doesn't skip the code
 * step either. Only the device a validly signed cookie names.
 *
 * @param ctx - The sign-out's endpoint context.
 */
export async function forgetSignedOutBrowserTrust(ctx: AuthHookContext): Promise<void> {
  const device = await browserTrustedDevice(ctx);
  if (device) {
    await forgetTrustedDevice(db, device.identifier);
  }
}

/**
 * Ends the session a request was made with when someone just signed in in
 * that browser: the same user again (e.g. confirming with a passkey or a
 * provider on the step-up page), so the old session doesn't linger as
 * another device, or someone else, whose session ends as if they had signed
 * out there, "Trust this device" included ({@link forgetOthersBrowserTrust}).
 * Like signing out, that records no event and sends no notice: it would show
 * the new user's name, IP address or browser to the other one. Only the
 * session a validly signed cookie names is ended (`signedSessionToken`).
 *
 * It runs from `afterAuthRequest`, before Better Auth's two-step plugin
 * decides about a password sign-in, so typing the password on a signed-in
 * browser ends the old session, whoever's it is, even when the code step
 * then starts and is never finished. That's on purpose: the plugin expires
 * the browser's session cookie when the code step starts (otherwise the
 * code would be checked as a step-up of the old session), so the old
 * session is unusable anyway, and this is the last moment it can be found.
 * Later, it would stay listed as a signed-in device until it expired.
 *
 * It also says whether the browser acts as someone else now: it had no
 * session that counts (no validly signed cookie, or one whose session is
 * gone), or someone else's. The same user again (a step-up) isn't.
 *
 * @param ctx - The endpoint context.
 * @param created - The new session.
 * @param created.id - Its ID.
 * @param created.userId - Its user.
 * @returns Whether the browser acts as someone else now.
 */
export async function replacePreviousSession(
  ctx: AuthHookContext,
  created: { id: string; userId: string },
): Promise<boolean> {
  const token = await signedSessionToken(ctx);
  if (!token) {
    return true;
  }
  const [ended] = await db
    .delete(sessionTable)
    .where(and(eq(sessionTable.token, token), ne(sessionTable.id, created.id)))
    .returning({ userId: sessionTable.userId });
  if (!ended) {
    return true;
  }
  if (ended.userId !== created.userId) {
    await forgetOthersBrowserTrust(ctx, created.userId);
    return true;
  }
  return false;
}

/**
 * Signs the browser out of everything but the "Last used" sign-in method:
 * removes every cookie the sign-out request sent (`cookiesToClearAtSignOut`),
 * on top of the session cookies Better Auth removes itself. That also drops
 * "Trust this device" (whose trusted device {@link forgetSignedOutBrowserTrust}
 * forgets), the provider-linked notice (which names an account) and the
 * provider step-up notice, so the next person on the browser starts clean.
 *
 * @param ctx - The endpoint context, after the request.
 */
export function clearCookiesAtSignOut(ctx: AuthHookContext): void {
  cookiesToClearAtSignOut(ctx.headers?.get('cookie')).forEach((name) => expireCookie(ctx, name));
}

/**
 * Asks the browser to drop what it keeps of Adiutor's responses at sign-out
 * (`Clear-Site-Data: "cache"`), such as the attached files it keeps and
 * checks with the server before each use, so the next person on a shared
 * computer finds none of them. Only the cache: the cookies are cleared one
 * by one ({@link clearCookiesAtSignOut}), so the "Last used" sign-in method
 * and the language stay. Firefox ignores it for now; a copy it keeps is
 * still only used once the server says the reader may.
 *
 * @param ctx - The endpoint context, after the request.
 */
export function clearCacheAtSignOut(ctx: AuthHookContext): void {
  ctx.setHeader?.('Clear-Site-Data', '"cache"');
}

/**
 * Removes {@link PROVIDER_LINKED_COOKIE} when a session starts in a request
 * that didn't just connect an account (someone else signing in on a browser
 * that wasn't signed out): it names that person's provider account (a GitHub
 * username, a Google email address), so they mustn't see it. Only when the
 * browser sent it. Signing out removes it as well ({@link clearCookiesAtSignOut}).
 *
 * @param ctx - The endpoint context, after the request.
 */
export function clearStaleProviderLinkedCookie(ctx: AuthHookContext): void {
  if (!ctx.context.newSession || requestState(ctx.context).providerLinkedCookieSet) {
    return;
  }
  expireCookieIfSent(ctx, PROVIDER_LINKED_COOKIE);
}

/**
 * Removes {@link PROVIDER_STEP_UP_COOKIE} when a session starts in a request
 * that isn't a provider step-up: what it said about an earlier "Confirm with
 * GitHub" no longer applies to the new session, which may be someone else's.
 * A provider step-up (`pendingProviderStepUp` in `request-state.ts`) sets or removes it
 * itself once the provider was asked ({@link recordProviderSession}), so it's
 * left alone here. Only when the browser sent it. Signing out removes it as
 * well ({@link clearCookiesAtSignOut}).
 *
 * @param ctx - The endpoint context, after the request.
 */
export function clearStaleProviderStepUpCookie(ctx: AuthHookContext): void {
  if (!ctx.context.newSession || requestState(ctx.context).pendingProviderStepUp) {
    return;
  }
  expireCookieIfSent(ctx, PROVIDER_STEP_UP_COOKIE);
}
