/**
 * @file The mode the page being rendered is kept in (decision 0053), for the
 * root layout: it renders `data-theme` on `<html>` while a staff Admin keeps
 * Adiutor in one mode, and hands it to the theme choices.
 */
import { cache } from 'react';

import { db } from '@/db';
import type { ForcedTheme } from '@/lib/theme';

import { loadForcedTheme } from './theme-settings';

/**
 * The mode every page is kept in, read at most once per request. The error
 * pages render inside the root layout too, and the database may be what's
 * failing: then each person's own choice stands, and the failure is logged
 * (without any value).
 *
 * @returns The mode, or `null` while each person chooses.
 */
const requestForcedTheme: () => Promise<ForcedTheme | null> = cache(async () => {
  try {
    return await loadForcedTheme(db);
  } catch {
    // eslint-disable-next-line no-console -- An operator should know the mode couldn't be read; nothing personal in it.
    console.warn('The light or dark mode could not be read; each person’s own choice stands.');
    return null;
  }
});

export default requestForcedTheme;
