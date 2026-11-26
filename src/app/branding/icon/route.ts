/**
 * @file The browser tab icon made from the brand (decision 0052), at
 * `/branding/icon`: 32 pixels square, or an Apple touch icon with
 * `?size=180`. Public (`PUBLIC_PATHS` in `src/proxy.ts`), like the pages that
 * link it. Each version is drawn once per process (`loadBrandIcon`), so
 * however it's asked for, a request never draws it again.
 */
import { connection, type NextRequest } from 'next/server';

import { db } from '@/db';
import { brandIconSize } from '@/lib/branding';
import { loadBrandIcon } from '@/server/branding';

import { imageResponse, noImage } from '../responses';

/**
 * Serves the icon. The version (`?v=`) only says how long it may be kept.
 *
 * @param request - The request.
 * @returns The PNG, or `404` while it's Adiutor's own icon.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const { searchParams } = request.nextUrl;
  const icon = await loadBrandIcon(db, brandIconSize(searchParams.get('size')));
  if (!icon) {
    return noImage();
  }
  return imageResponse(icon.png, 'image/png', searchParams.get('v') === icon.version);
}
