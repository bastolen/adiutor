/**
 * @file The hook after a password sign-in: the session's MFA level when no code
 * step follows, and the audit event when one does.
 */
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import { signInMethodFromPath } from '@/lib/authz/mfa';

import { recordEvent } from '../../audit';
import { normalizeEmail } from '../auth-guards';
import { type AuthHookContext, safely, auditContext } from './hook-context';
import rememberLanguage from './language';
import { recordSignIn } from './session-hooks';
import { markSessionVerified } from './session-records';

/**
 * Checks whether a password sign-in stopped to ask for a code: Better Auth's
 * two-step plugin then answers `{ twoFactorRedirect: true }` instead of the
 * session it deleted.
 *
 * @param returned - The endpoint's response, after the plugin's reaction.
 * @returns Whether the code step started.
 */
function startedCodeStep(returned: unknown): boolean {
  return (
    typeof returned === 'object' &&
    returned !== null &&
    'twoFactorRedirect' in returned &&
    returned.twoFactorRedirect === true
  );
}

/**
 * After a password sign-in (`/sign-in/email`), once Better Auth's two-step
 * plugin has decided whether its session stays: `src/lib/auth.ts` runs this
 * in a plugin registered right after `twoFactor`, since the app's own
 * reactions after a request ({@link afterAuthRequest}) run before any
 * plugin's.
 *
 * - The session stayed (no two-step verification, or a device trusted at an
 *   earlier code step): records the sign-in and that the user is active, and
 *   marks a trusted device's session verified. Better Auth only keeps the
 *   password session of a user with two-step verification on such a device.
 * - The code step started (the plugin deleted the session): records only
 *   that the password was right (`sign_in_code_pending`), without an actor:
 *   whoever typed it may not be the user, so the user's own activity leaves
 *   out the IP address and browser (`listOwnActivity`). The user isn't
 *   active yet. The code step records the sign-in if it's finished.
 *
 * Wrong passwords are recorded by {@link afterAuthRequest}.
 *
 * @param ctx - The endpoint context, with the plugin's outcome.
 */
export async function afterPasswordSignIn(ctx: AuthHookContext): Promise<void> {
  if (ctx.path !== '/sign-in/email') {
    return;
  }
  const method = signInMethodFromPath(ctx.path);
  const { newSession, returned } = ctx.context;
  if (newSession) {
    const created = { ...newSession.session, userId: newSession.user.id };
    if (newSession.user.twoFactorEnabled) {
      await safely('mark trusted device', () => markSessionVerified(created.id, 'trusted_device'));
    }
    await safely('record password sign-in', async () => {
      await db.update(user).set({ lastActiveAt: new Date() }).where(eq(user.id, created.userId));
      if (method) {
        await recordSignIn(created, method);
      }
    });
    await safely('remember the language', () => rememberLanguage(ctx, created.userId));
    return;
  }
  if (!startedCodeStep(returned)) {
    return;
  }
  await safely('record password before the code step', async () => {
    // The plugin deleted the session, so the user comes from the address Better Auth matched.
    const email = normalizeEmail(ctx.body?.email);
    const [pending] = email
      ? await db.select({ id: user.id }).from(user).where(eq(user.email, email))
      : [];
    if (!pending) {
      return;
    }
    await recordEvent(auditContext(ctx.headers), {
      action: 'sign_in_code_pending',
      actorUserId: null,
      targetUserId: pending.id,
      details: { method },
    });
  });
}
