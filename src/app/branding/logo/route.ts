/**
 * @file The logo a staff Admin uploaded (decision 0052), at
 * `/branding/logo`: the PNG Adiutor drew from the upload. Public
 * (`PUBLIC_PATHS` in `src/proxy.ts`): the sign-in pages show it, and emails
 * link it for mail clients that fetch it without a session.
 */
import { connection, type NextRequest } from 'next/server';

import { db } from '@/db';
import { loadBrandImage } from '@/server/branding';

import { imageResponse, noImage } from '../responses';

/**
 * Serves the logo. The version (`?v=`) only says how long it may be kept:
 * whatever it says, the current logo is served.
 *
 * @param request - The request.
 * @returns The PNG, or `404` while no logo was uploaded.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const logo = await loadBrandImage(db, 'logo');
  if (!logo) {
    return noImage();
  }
  return imageResponse(
    logo.content,
    'image/png',
    request.nextUrl.searchParams.get('v') === logo.id,
  );
}
