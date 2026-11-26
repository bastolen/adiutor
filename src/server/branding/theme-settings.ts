/**
 * @file The mode a staff Admin keeps Adiutor in (decision 0053): light and
 * dark as each person chooses, or one only, on the Appearance tab of
 * Settings. Staff Admins only (`staff:manage`) to read and change it; pages
 * read it with `loadForcedTheme`, which checks no permission.
 */
import type { DatabaseOrTransaction } from '@/db';
import type { ForcedTheme } from '@/lib/theme';
import { themeModeChoiceSchema } from '@/lib/validation';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { readSettings, writeSettings } from '../settings';

/**
 * Loads the mode every page is kept in.
 *
 * @param db - Database client or transaction.
 * @returns The mode, or `null` while each person chooses.
 */
export async function loadForcedTheme(db: DatabaseOrTransaction): Promise<ForcedTheme | null> {
  return (await readSettings(db, ['brand.forced_theme']))['brand.forced_theme'];
}

/**
 * Reads the mode every page is kept in, to change it.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @returns The mode, or `null` while each person chooses.
 */
export async function getForcedTheme(
  ctx: ServiceContext,
  actor: Actor,
): Promise<ForcedTheme | null> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  return loadForcedTheme(ctx.db);
}

/**
 * Keeps every page in one mode, or lets each person choose again. Everyone
 * sees the change, so it's recorded in the audit log with the mode it
 * replaced, like the brand colours.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param choice - `both`, `light` or `dark`, as the Appearance tab sends it.
 * @returns The mode kept, or `null` for both.
 * @throws {ZodError} When the choice is none of them.
 */
export async function setForcedTheme(
  ctx: ServiceContext,
  actor: Actor,
  choice: unknown,
): Promise<ForcedTheme | null> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const forced = themeModeChoiceSchema.parse(choice);
  await ctx.db.transaction(async (tx) => {
    const before = await writeSettings(tx, { 'brand.forced_theme': forced });
    await recordEvent(
      ctx,
      {
        action: 'brand_theme_changed',
        actorUserId: actor.id,
        details: { staff: true, from: before['brand.forced_theme'], to: forced },
      },
      tx,
    );
  });
  return forced;
}
