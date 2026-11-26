/**
 * @file The CSS that gives a page the brand colours, for the root layout.
 */
import { cache } from 'react';

import { db } from '@/db';
import { derivePalette, paletteCss } from '@/lib/branding';

import loadBrandColours from './colours';

/**
 * The CSS for the brand colours (`paletteCss`), worked out at most once per
 * request. The error pages render inside the root layout too, and the
 * database may be what's failing: then, or should working out the palette
 * ever fail, the page keeps the theme's colours, and the failure is logged
 * (without any value).
 *
 * @returns A `:root:root { … }` rule, or an empty string when the theme's colours stand.
 */
const pageBrandCss: () => Promise<string> = cache(async () => {
  try {
    return paletteCss(derivePalette(await loadBrandColours(db)));
  } catch {
    // eslint-disable-next-line no-console -- An operator should know the brand colours couldn't be read; nothing personal in it.
    console.warn('The brand colours could not be read; a page uses the theme’s colours.');
    return '';
  }
});

export default pageBrandCss;
