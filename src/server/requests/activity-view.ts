/**
 * @file How the signed-in user reads a request's activity
 * (`user.activity_order`, `user.activity_groups`): its order and the groups
 * of entries it shows, chosen with the menus on a request's page and saved
 * with their account, so it holds on every request and device. `getRequest`
 * reads it for the request it loads. The rules (the groups, what they show,
 * how a choice is tidied) are in `src/lib/requests/activity.ts`. Not a
 * security change: no audit event or notice.
 */
import { eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { user } from '@/db/schema';
import {
  type ActivityView,
  DEFAULT_ACTIVITY_ORDER,
  isActivityGroup,
  isActivityOrder,
  normalizeActivityGroups,
} from '@/lib/requests';
import { activityViewSchema } from '@/lib/validation';

import { assertNotSignedInAs } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';

/**
 * Reads a user's saved view. A stored value this version doesn't know
 * (a group or an order a later version added, then took away) counts as
 * nothing saved, so the view falls back to the default rather than failing.
 *
 * @param db - Database client.
 * @param userId - The user.
 * @returns Their view: the order, and the groups (`null` for everything).
 */
export async function readActivityView(db: Database, userId: string): Promise<ActivityView> {
  const [found] = await db
    .select({ order: user.activityOrder, groups: user.activityGroups })
    .from(user)
    .where(eq(user.id, userId));
  const groups = found?.groups?.filter(isActivityGroup) ?? [];
  return {
    order: isActivityOrder(found?.order) ? found.order : DEFAULT_ACTIVITY_ORDER,
    groups: normalizeActivityGroups(groups),
  };
}

/**
 * Saves how the user reads a request's activity: its order, the groups it
 * shows, or both (what's left out stays as it was). The groups are tidied
 * the one way they're saved (`normalizeActivityGroups`): everything, or
 * nothing, is saved as everything. Anyone signed in may choose it for
 * themselves, and only for themselves.
 *
 * @param ctx - Service context.
 * @param actor - The signed-in user.
 * @param input - What the menus sent: `order` and/or `groups` (`null` for everything).
 * @returns The view as it's saved now.
 * @throws {ServiceError} `signed_in_as` while a staff member is signed in as the user.
 * @throws {ZodError} When it holds an order or group there isn't (`validation.checkInput`).
 */
export async function setActivityView(
  ctx: ServiceContext,
  actor: Actor,
  input: unknown,
): Promise<ActivityView> {
  assertNotSignedInAs(actor);
  const { order, groups } = activityViewSchema.parse(input);
  const changes: {
    activityOrder?: ActivityView['order'] | null;
    activityGroups?: string[] | null;
  } = {};
  if (order !== undefined) {
    // The default is stored as nothing, like a user who never chose.
    changes.activityOrder = order === DEFAULT_ACTIVITY_ORDER ? null : order;
  }
  if (groups !== undefined) {
    changes.activityGroups = groups === null ? null : normalizeActivityGroups(groups);
  }
  if (Object.keys(changes).length > 0) {
    await ctx.db.update(user).set(changes).where(eq(user.id, actor.id));
  }
  return readActivityView(ctx.db, actor.id);
}
