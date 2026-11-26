/**
 * @file Where the browser tab icon comes from (decision 0052), so a staff
 * Admin who uploads a logo needn't make one: their own icon if they uploaded
 * one, else the logo itself when it's about square, else the staff name's
 * initials on the accent colour. Without either upload, it's Adiutor's.
 */
import initialsOf from '../initials';
import { type ImageSize, isAboutSquare } from './images';

/** What the browser tab icon is drawn from. */
export type BrandIconSource =
  { kind: 'icon' } | { kind: 'logo' } | { kind: 'initials'; letters: string };

/** The sizes the icon is drawn at: a browser tab's, and an Apple touch icon's. */
export const BRAND_ICON_SIZES = [32, 180] as const;

/** One of {@link BRAND_ICON_SIZES}. */
export type BrandIconSize = (typeof BRAND_ICON_SIZES)[number];

/**
 * Whether initials can be drawn: the letters of a Latin script and digits,
 * which the font the icon is drawn in has. Any other script would show as
 * empty boxes.
 */
const DRAWABLE_INITIALS = /^[\p{Script=Latin}\p{Nd}]+$/u;

/**
 * Where the browser tab icon comes from.
 *
 * @param images - The sizes of the images that were uploaded.
 * @param images.logo - The logo's, if there is one.
 * @param images.icon - The own icon's, if there is one.
 * @param staffName - The staff's name, for its initials.
 * @returns The source, or `null` for Adiutor's own icon.
 */
export function brandIconSource(
  images: { logo?: ImageSize; icon?: ImageSize },
  staffName: string,
): BrandIconSource | null {
  if (images.icon) {
    return { kind: 'icon' };
  }
  if (!images.logo) {
    return null;
  }
  if (isAboutSquare(images.logo)) {
    return { kind: 'logo' };
  }
  const letters = initialsOf(staffName);
  // A name in another script still gets an icon: the logo, made to fit.
  return DRAWABLE_INITIALS.test(letters) ? { kind: 'initials', letters } : { kind: 'logo' };
}

/**
 * The icon size a request asks for (`?size=`): an Apple touch icon's when it
 * says so, a browser tab's otherwise.
 *
 * @param value - The parameter's value, if any.
 * @returns The size.
 */
export function brandIconSize(value: string | null): BrandIconSize {
  return value === '180' ? 180 : 32;
}

/**
 * Where the brand's images are served (`src/app/branding/`), to anyone,
 * signed in or not: the sign-in pages show the logo, and emails link it.
 */
export const BRANDING_PATH = '/branding';

/**
 * The logo's address, with its version: a new upload gets a new address, so
 * browsers and mail clients may keep it as long as they like.
 *
 * @param id - The logo's ID.
 * @returns The path, e.g. `/branding/logo?v=0193…`.
 */
export function brandLogoPath(id: string): string {
  return `${BRANDING_PATH}/logo?v=${encodeURIComponent(id)}`;
}

/**
 * The browser tab icon's address, with its version.
 *
 * @param version - The icon's version.
 * @param size - Its size.
 * @returns The path, e.g. `/branding/icon?size=180&v=…`.
 */
export function brandIconPath(version: string, size: BrandIconSize): string {
  const query = new URLSearchParams(
    size === 32 ? { v: version } : { size: String(size), v: version },
  );
  return `${BRANDING_PATH}/icon?${query.toString()}`;
}
