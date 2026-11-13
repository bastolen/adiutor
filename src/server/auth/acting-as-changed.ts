/**
 * @file Tells the browser's tabs that it acts as someone else now, from a
 * server action that signs someone in or out and then redirects: setup,
 * creating an account from an invitation, and joining with an invite link
 * when that ends the session. A server action's redirect is a navigation
 * within the app, so no code of the page that made the change runs to load
 * it afresh or tell the other tabs. The action leaves the next page a cookie
 * instead (`ACTING_AS_CHANGED_COOKIE`), and `ReloadWhenActingAsChanges` in
 * the root layout removes it, loads that tab afresh and tells the others.
 * The forms keep working before JavaScript has loaded: the redirect still
 * goes to the right page then.
 */
import 'server-only';

import { cookies } from 'next/headers';

import { ACTING_AS_CHANGED_COOKIE } from '@/lib/sign-in/auth-cookies';

import nextPageCookieOptions from './next-page-cookie';

/**
 * Leaves the next page the cookie that says the browser acts as someone else
 * now (only `1`, never who). Call it once the change is made, before the
 * action's `redirect()`.
 */
export default async function markActingAsChanged(): Promise<void> {
  (await cookies()).set(ACTING_AS_CHANGED_COOKIE, '1', nextPageCookieOptions());
}
