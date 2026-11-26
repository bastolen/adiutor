/**
 * @file The brand's images for the page being rendered (decision 0052): the
 * logo's address and size, for `Logo` through the root layout's provider,
 * and the browser tab icon's version, for the page's icons. Read once per
 * request.
 */
import type { Metadata } from 'next';
import { cache } from 'react';

import { db } from '@/db';
import { brandIconPath, brandLogoPath, derivePalette } from '@/lib/branding';

import { planBrandIcon } from './brand-icon';
import { loadBrandImages } from './brand-images';
import loadBrandColours from './colours';
import requestStaffName from './page-name';

/** The uploaded logo, as a page shows it. */
export interface PageLogo {
  /** Its address, with its version. */
  src: string;
  /** Its width in pixels. */
  width: number;
  /** Its height in pixels. */
  height: number;
}

/** The brand's images as a page needs them. */
export interface PageBrandImages {
  /** The uploaded logo, or `null` for Adiutor's. */
  logo: PageLogo | null;
  /** The browser tab icon's version, or `null` for Adiutor's icon. */
  iconVersion: string | null;
}

/** What a page shows without the brand's images: Adiutor's logo and icon. */
const ADIUTOR_IMAGES: PageBrandImages = { logo: null, iconVersion: null };

/**
 * The brand's images, read at most once per request. The error pages render
 * inside the root layout too, and the database may be what's failing: then
 * the page shows Adiutor's logo and icon, and the failure is logged (without
 * any value).
 *
 * @returns The logo and the icon's version.
 */
const requestBrandImages: () => Promise<PageBrandImages> = cache(async () => {
  try {
    const [images, staffName, colours] = await Promise.all([
      loadBrandImages(db),
      requestStaffName(),
      loadBrandColours(db),
    ]);
    const { logo } = images;
    return {
      logo: logo ? { src: brandLogoPath(logo.id), width: logo.width, height: logo.height } : null,
      iconVersion: planBrandIcon(images, staffName, derivePalette(colours))?.version ?? null,
    };
  } catch {
    // eslint-disable-next-line no-console -- An operator should know the brand's images couldn't be read; nothing personal in it.
    console.warn('The brand’s images could not be read; a page shows Adiutor’s logo and icon.');
    return ADIUTOR_IMAGES;
  }
});

export default requestBrandImages;

/**
 * The page's icons: the one made from the brand, at a browser tab's size and
 * as an Apple touch icon, or Adiutor's own (its `.ico` and SVG in `public/brand/`).
 *
 * @param iconVersion - The brand icon's version, or `null` for Adiutor's.
 * @returns The `icons` of the page's metadata.
 */
export function pageIcons(iconVersion: string | null): NonNullable<Metadata['icons']> {
  if (!iconVersion) {
    return {
      icon: [
        { url: '/brand/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
        { url: '/brand/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    };
  }
  return {
    icon: [{ url: brandIconPath(iconVersion, 32), sizes: '32x32', type: 'image/png' }],
    apple: [{ url: brandIconPath(iconVersion, 180), sizes: '180x180', type: 'image/png' }],
  };
}
