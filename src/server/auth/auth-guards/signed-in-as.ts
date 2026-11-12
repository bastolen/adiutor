/**
 * @file Refuses Better Auth's endpoints while a staff member is signed in as
 * a user ("Sign in as", see docs/decisions/0017-staff-sign-in-as-users.md).
 * The session is the staff member's, so an endpoint would act on their own
 * account while the screen shows the user's: nothing changes from that view.
 * Only reading the session (which every page does) and signing out pass.
 */
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { impersonation, session } from '@/db/schema';
import { SIGNED_IN_AS_SOMEONE } from '@/lib/sign-in/sign-in-refusals';

import { signedSessionToken } from '../signed-session';
import type { AuthGuardContext } from './paths';
import { refusalBody } from './refusal-messages';

/**
 * The endpoints a session signed in as someone may still use: reading the
 * session (`auth.api.getSession`, behind every page) and signing out, which
 * ends the staff member's session and with it the sign-in as the user.
 */
const ALLOWED_WHILE_SIGNED_IN_AS: ReadonlySet<string> = new Set(['/get-session', '/sign-out']);

/**
 * Refuses a Better Auth request made with a session that's signed in as
 * someone (also once its time is up, until a request ends it), except
 * {@link ALLOWED_WHILE_SIGNED_IN_AS}. Requests without a validly signed
 * session cookie, such as signing in, aren't looked up.
 *
 * @param ctx - The endpoint context.
 * @param path - The endpoint's path.
 * @throws {APIError} `FORBIDDEN` with `SIGNED_IN_AS_SOMEONE`.
 */
export default async function refuseWhileSignedInAs(
  ctx: AuthGuardContext,
  path: string,
): Promise<void> {
  if (ALLOWED_WHILE_SIGNED_IN_AS.has(path)) {
    return;
  }
  const token = await signedSessionToken(ctx);
  if (!token) {
    return;
  }
  const [found] = await db
    .select({ id: impersonation.id })
    .from(impersonation)
    .innerJoin(session, eq(session.id, impersonation.sessionId))
    .where(eq(session.token, token))
    .limit(1);
  if (found) {
    throw new APIError('FORBIDDEN', refusalBody(ctx, SIGNED_IN_AS_SOMEONE.code));
  }
}
