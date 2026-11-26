/**
 * @file The name new authenticator entries and passkeys are labelled with
 * (decision 0050): the staff's name with Adiutor's after it, e.g. "Acme
 * Support (Adiutor)", or just "Adiutor" while that's the staff's name.
 * Better Auth labels them with its app name when no issuer or passkey name is
 * configured (`issuer || appName`, `rpName || appName`), so for the
 * endpoints that create them this hands Better Auth the label as that
 * request's app name. Entries made earlier keep the label they got.
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

/** What a before-hook returns to change the request: Better Auth merges it into that request's context. */
export interface AuthRequestChange {
  /** The request's context to merge in. */
  context: { context: { appName: string } };
}

/**
 * The app name for a request that labels a new authenticator entry or
 * passkey. Should the staff's name not be read, the label stays Better
 * Auth's configured one ("Adiutor").
 *
 * @param ctx - The Better Auth request.
 * @returns The change to the request, or nothing for any other endpoint.
 */
export async function signInAppNameFor(
  ctx: AuthGuardContext,
): Promise<AuthRequestChange | undefined> {
  if (!ctx.path || !SIGN_IN_APP_NAME_PATHS.has(ctx.path)) {
    return undefined;
  }
  const name = await getStaffName(db).catch(() => null);
  return name === null ? undefined : { context: { context: { appName: signInAppName(name) } } };
}
