/**
 * @file The brand colours on the Appearance tab of Settings (decision 0047):
 * reading them to edit, and saving them. Staff Admins only (`staff:manage`).
 * Pages and emails read them with `loadBrandColours` (`colours.ts`), which
 * checks no permission.
 */
import type { BrandColours } from '@/lib/branding';
import { brandColoursSchema } from '@/lib/validation';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { writeSettings } from '../settings';
import loadBrandColours from './colours';

/** The brand colours as the Appearance tab sends them: each a colour, or empty for the theme's own. */
export interface BrandColoursInput {
  /** Main actions, links and focus rings. */
  accent: unknown;
  /** The accent in dark mode; only with an accent. */
  accentDark: unknown;
  /** The colour whose hue the greys take. */
  tint: unknown;
}

/**
 * Reads the brand colours, to edit them.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @returns The accent, the dark accent and the tint; `null` for each the theme keeps.
 */
export async function getBrandColours(ctx: ServiceContext, actor: Actor): Promise<BrandColours> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  return loadBrandColours(ctx.db);
}

/**
 * Saves the brand colours, which every page and email then shows. Everyone
 * sees the change, so it's recorded in the audit log with the colours it
 * replaced, like the name shown to users.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The colours, each in six hex digits (with or without `#`) or empty.
 * @returns The colours as they were saved (`#` and lower case).
 * @throws {ZodError} When a colour isn't six hex digits, or a dark accent comes without an accent.
 */
export async function setBrandColours(
  ctx: ServiceContext,
  actor: Actor,
  input: BrandColoursInput,
): Promise<BrandColours> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const colours = brandColoursSchema.parse(input);
  await ctx.db.transaction(async (tx) => {
    const before = await writeSettings(tx, {
      'brand.accent': colours.accent,
      'brand.accent_dark': colours.accentDark,
      'brand.tint': colours.tint,
    });
    await recordEvent(
      ctx,
      {
        action: 'brand_colours_changed',
        actorUserId: actor.id,
        details: {
          staff: true,
          from: {
            accent: before['brand.accent'],
            accentDark: before['brand.accent_dark'],
            tint: before['brand.tint'],
          },
          to: colours,
        },
      },
      tx,
    );
  });
  return colours;
}
