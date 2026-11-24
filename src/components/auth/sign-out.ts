/**
 * @file Signing out from the browser: the account menu and the step-up page
 * end the session, then load the sign-in page afresh in every tab of the
 * browser. The client is loaded when it's needed (`loadAuthClient`), as
 * signed-in pages do.
 */
'use client';

import loadFresh from '@/components/ui/load-fresh';
import loadAuthClient from '@/lib/sign-in/load-auth-client';

/**
 * Ends the session, then loads the sign-in page afresh (`loadFresh`): a
 * navigation within the app would keep this person's pages alive for the
 * next one to sign in on this browser. The browser's other tabs load their
 * own page afresh too (`everyTab`), which takes them to the sign-in page, so
 * none of them keeps showing this person's pages.
 *
 * Better Auth's client resolves with an `error` when the server refuses (a
 * 5xx, a rate limit) and rejects when the request never gets there (as does
 * loading the client): either way the session hasn't ended, so nothing
 * loads, and the caller says so.
 *
 * @returns Whether the session ended (the sign-in page is loading); `false` when it didn't.
 */
export default async function signOutAndLeave(): Promise<boolean> {
  try {
    const authClient = await loadAuthClient();
    const result = await authClient.signOut();
    if (result.error) {
      return false;
    }
  } catch {
    return false;
  }
  loadFresh('/auth', { everyTab: true });
  return true;
}
