/**
 * @file People's pictures, served at `/avatars/<account ID>`: the picture of
 * a connected GitHub or Google account, fetched from the provider when a
 * browser asks for it (`loadPicture` in `src/server/people/pictures.ts`), so
 * browsers never contact the provider and the Content Security Policy keeps
 * images to Adiutor's own address. Only for someone signed in (the proxy
 * protects it like every page), and only while the account is the picture
 * its owner shows; anything else is "not found". See decision 0022.
 */
import type { NextRequest } from 'next/server';

import appContext from '@/server/app-context';
import { getOptionalActor } from '@/server/authz';
import { loadPicture } from '@/server/people/pictures';

/**
 * Serves a picture. Browsers keep it for a day; its address changes when
 * the picture does (`?v=`), so a new one is fetched right away. The version
 * is only for browsers' caches: whatever it says, the account's ID alone
 * picks what's served.
 *
 * @param _request - The request (unused).
 * @param context - The route's parameters: the account's ID.
 * @returns The image, or `404` when there's none to serve here.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<'/avatars/[account]'>,
): Promise<Response> {
  const notFound = new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!(await getOptionalActor())) {
    return notFound;
  }
  const picture = await loadPicture(appContext, (await context.params).account);
  if (!picture) {
    return notFound;
  }
  return new Response(picture.body, {
    headers: {
      'Content-Type': picture.contentType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
