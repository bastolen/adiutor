/**
 * @file Which cookies a sign-out removes: every one the browser sent, except
 * the "Last used" sign-in method (Better Auth's `lastLoginMethod` plugin), so
 * the sign-in page can still mark it. That also forgets "Trust this device",
 * and anything that names someone (e.g. the provider-linked notice), so the
 * next person on the browser starts clean. Safe for Client Components.
 */

/**
 * The cookie that remembers the last sign-in method in this browser. The app
 * names it after itself and gives the name to Better Auth's `lastLoginMethod`
 * plugin on both sides (its `cookieName` in `src/lib/auth.ts` and
 * `src/lib/sign-in/auth-client.ts`), so setting, reading and keeping it at
 * sign-out all follow this one constant. It only says how (e.g. "github"),
 * never who.
 */
export const LAST_USED_LOGIN_METHOD_COOKIE = 'adiutor.last_used_login_method';

/**
 * Lists the cookies to remove when someone signs out.
 *
 * @param cookieHeader - The sign-out request's `Cookie` header, if any.
 * @returns Their names, each once, without {@link LAST_USED_LOGIN_METHOD_COOKIE}.
 */
export function cookiesToClearAtSignOut(cookieHeader: string | null | undefined): string[] {
  if (!cookieHeader) {
    return [];
  }
  const names = cookieHeader
    .split(';')
    .map((part) => (part.split('=')[0] ?? '').trim())
    .filter(Boolean);
  return [...new Set(names)].filter((name) => name !== LAST_USED_LOGIN_METHOD_COOKIE);
}
