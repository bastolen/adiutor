/**
 * @file The name new authenticator entries and passkeys are labelled with
 * (decision 0050): the staff's name with Adiutor's after it, e.g. "Acme
 * Support (Adiutor)", or just "Adiutor" while that's the staff's name.
 * Better Auth labels them with its app name when no issuer or passkey name is
 * configured (`issuer || appName`, `rpName || appName`), so for the
 * endpoints that create them the before-hook in `src/lib/auth.ts` sets the
 * label as that request's app name, on the request's own context. It never
 * returns it as a context change: Better Auth would then hand the endpoint a
 * new context object, and lose the state the guards keep under the old one
 * (`request-state.ts`). Entries made earlier keep the label they got.
 */
import { db } from '@/db';
import { signInAppName } from '@/lib/branding';

import getStaffName from '../../people/staff-name';
import type { AuthGuardContext } from './paths';

/** The endpoints that label a new authenticator entry or passkey. */
export const SIGN_IN_APP_NAME_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/enable',
  '/two-factor/get-totp-uri',
  '/passkey/generate-register-options',
]);

/**
 * The app name for a request that labels a new authenticator entry or
 * passkey. Should the staff's name not be read, the label stays Better
 * Auth's configured one ("Adiutor"), and that's logged (without any value).
 *
 * @param ctx - The Better Auth request.
 * @returns The label, or nothing for any other endpoint.
 */
export async function signInAppNameFor(ctx: AuthGuardContext): Promise<string | undefined> {
  if (!ctx.path || !SIGN_IN_APP_NAME_PATHS.has(ctx.path)) {
    return undefined;
  }
  try {
    return signInAppName(await getStaffName(db));
  } catch {
    // eslint-disable-next-line no-console -- An operator should know the label fell back; nothing personal in it.
    console.warn('The staff’s name could not be read; a new sign-in entry is labelled Adiutor.');
    return undefined;
  }
}
