/**
 * @file The logo and browser tab icon on the General tab of Settings
 * (decision 0052), read to show and change them. Staff Admins only
 * (`staff:manage`); uploading and removing them is in `brand-images.ts`.
 */
import { type BrandIconSource, type BrandLogo, brandLogoPath } from '@/lib/branding';

import { assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { loadBrandIconPlan } from './brand-icon';
import { loadBrandImages } from './brand-images';

/** What the General tab shows of the logo and the icon. */
export interface BrandImageSettings {
  /** The uploaded logo, or `null` while it's Adiutor's. */
  logo: BrandLogo | null;
  /** Whether an own icon was uploaded, which can be removed. */
  ownIcon: boolean;
  /**
   * The icon made from the brand: its version, for its address, and what
   * it's drawn from; `null` while it's Adiutor's.
   */
  icon: { version: string; source: BrandIconSource['kind'] } | null;
}

/**
 * Reads the logo and the icon, to show and change them.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @returns The logo, whether there's an own icon, and the icon made from them.
 */
export default async function getBrandImageSettings(
  ctx: ServiceContext,
  actor: Actor,
): Promise<BrandImageSettings> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const [images, plan] = await Promise.all([loadBrandImages(ctx.db), loadBrandIconPlan(ctx.db)]);
  const { logo, icon } = images;
  return {
    logo: logo ? { src: brandLogoPath(logo.id), width: logo.width, height: logo.height } : null,
    ownIcon: Boolean(icon),
    icon: plan ? { version: plan.version, source: plan.source.kind } : null,
  };
}
