/**
 * @file The CSS that gives a page the brand colours, for the root layout.
 */
import { cache } from 'react';

import { db } from '@/db';
import { derivePalette, NO_BRAND_COLOURS, paletteCss } from '@/lib/branding';

import loadBrandColours from './colours';

/**
 * The CSS for the brand colours (`paletteCss`), worked out at most once per
 * request. The error pages render inside the root layout too, and the
 * database may be what's failing: then the page keeps the theme's colours.
 *
 * @returns A `:root:root { … }` rule, or an empty string when the theme's colours stand.
 */
const pageBrandCss: () => Promise<string> = cache(async () =>
  paletteCss(derivePalette(await loadBrandColours(db).catch(() => NO_BRAND_COLOURS))),
);

export default pageBrandCss;
