/**
 * @file Whether a user dismissed the dashboard's recommendation to add a
 * passkey or two-step verification. It's saved with the account, so the
 * dashboard knows on the server and shows the notice from the first paint
 * (it doesn't pop in once the browser has checked), and it stays dismissed on
 * every device. Each user dismisses only their own. Not a security change: no
 * audit event or notice.
 */
import { eq } from 'drizzle-orm';

import { user } from '@/db/schema';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';

/**
 * Records that the user dismissed the recommendation. Anyone signed in may
 * dismiss theirs, and only theirs; dismissing again keeps it dismissed.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @returns Nothing, once it's saved.
 */
export async function dismissMfaRecommendation(ctx: ServiceContext, actor: Actor): Promise<void> {
  await ctx.db
    .update(user)
    .set({ mfaRecommendationDismissedAt: new Date() })
    .where(eq(user.id, actor.id));
}

/**
 * Whether the user dismissed the recommendation.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @returns Whether they dismissed it.
 */
export async function isMfaRecommendationDismissed(
  ctx: ServiceContext,
  actor: Actor,
): Promise<boolean> {
  const [row] = await ctx.db
    .select({ dismissedAt: user.mfaRecommendationDismissedAt })
    .from(user)
    .where(eq(user.id, actor.id));
  return Boolean(row?.dismissedAt);
}
