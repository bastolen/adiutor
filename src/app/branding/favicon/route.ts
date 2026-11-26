/**
 * @file `/favicon.ico` (a rewrite in `next.config.ts` sends it here), for
 * tools that ask for it without reading the page: the browser tab icon made
 * from the brand as an `.ico` (decision 0052), or Adiutor's own while
 * nothing was uploaded. Public, like the icon.
 */
import { connection } from 'next/server';

import { db } from '@/db';
import { icoOf, loadBrandIcon } from '@/server/branding';

import { adiutorFile, imageResponse } from '../responses';

/** Adiutor's own `.ico`, a static file. */
const ADIUTOR_FAVICON = '/brand/favicon.ico';

/**
 * Serves the icon as an `.ico`. Its address has no version, so it's kept
 * for five minutes only.
 *
 * @returns The `.ico`, or a redirect to Adiutor's.
 */
export async function GET(): Promise<Response> {
  await connection();
  const icon = await loadBrandIcon(db, 32);
  if (!icon) {
    return adiutorFile(ADIUTOR_FAVICON);
  }
  return imageResponse(icoOf(icon.png, 32), 'image/x-icon', false);
}
