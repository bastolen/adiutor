/**
 * @file Loads the Better Auth client when it's first needed. Signed-in pages
 * only use it in handlers (signing out, the Security page's changes), so they
 * load it then instead of downloading it with the page; the sign-in pages,
 * which are there to use it, import `auth-client.ts` directly.
 * `src/client-imports.test.ts` keeps signed-in pages from importing it
 * statically.
 */
import type authClient from './auth-client';

/**
 * Loads the Better Auth client (once; later calls get the loaded module).
 * Calling it early without waiting (e.g. when a menu opens) starts the
 * download, so a click that follows doesn't wait for it.
 *
 * @returns The auth client.
 */
export default async function loadAuthClient(): Promise<typeof authClient> {
  return (await import('./auth-client')).default;
}
