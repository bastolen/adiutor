/**
 * @file The signed-in user's own choice whether they get emails about
 * requests at all (`user.request_emails`): on unless they turn it off on
 * their account's Profile page. Unsubscribing from one request stops that
 * request's emails; this stops all of them, also for the requests assigned
 * to them. The emails are checked against it when they're sent
 * (`readRequestUpdate`). Not a security change: no audit event or notice.
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';

import { assertNotSignedInAs } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';

/**
 * Whether the user gets emails about requests, for the account's card. A row
 * from before the setting existed (`null`) counts as on.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @returns Whether they get them.
 */
export async function ownRequestEmails(ctx: ServiceContext, actor: Actor): Promise<boolean> {
  const [found] = await ctx.db
    .select({ requestEmails: user.requestEmails })
    .from(user)
    .where(eq(user.id, actor.id));
  return found?.requestEmails !== false;
}

/**
 * Turns emails about requests on or off for the user's own account. Anyone
 * signed in may choose it for themselves, and only for themselves. An email
 * that waits in the queue is checked when it's sent, so turning it off also
 * stops what's on its way.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param on - Whether they want them.
 * @returns What's set now.
 * @throws {ServiceError} `signed_in_as` while a staff member is signed in as them.
 */
export async function setOwnRequestEmails(
  ctx: ServiceContext,
  actor: Actor,
  on: boolean,
): Promise<boolean> {
  assertNotSignedInAs(actor);
  await ctx.db.update(user).set({ requestEmails: on }).where(eq(user.id, actor.id));
  return on;
}
