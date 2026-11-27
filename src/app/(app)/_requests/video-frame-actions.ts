/**
 * @file Sends the frame a browser drew of a video it uploaded, as the
 * video's preview (decision 0057, `setVideoFrame`). Request work, so it's
 * allowed while a staff member is signed in as a user (decision 0028). A
 * frame that isn't taken changes nothing the uploader sees but the tile:
 * the video keeps its icon, so nothing is said.
 */
'use server';

import { VIDEO_FRAME_MAX_BYTES } from '@/lib/requests';
import appContext from '@/server/app-context';
import { getActor } from '@/server/authz';
import { ServiceError } from '@/server/errors';
import { setVideoFrame } from '@/server/requests';

/**
 * Takes a video's frame: the form's `attachment` (the video's ID) and
 * `frame` (the image).
 *
 * @param form - The video's ID and its frame.
 * @returns Whether the preview was set.
 */
export async function videoFrameAction(form: FormData): Promise<boolean> {
  const attachment = form.get('attachment');
  const frame = form.get('frame');
  if (
    typeof attachment !== 'string' ||
    !(frame instanceof File) ||
    frame.size > VIDEO_FRAME_MAX_BYTES
  ) {
    return false;
  }
  const actor = await getActor();
  try {
    const result = await setVideoFrame(appContext, actor, {
      attachment,
      frame: new Uint8Array(await frame.arrayBuffer()),
    });
    return result.preview;
  } catch (error) {
    if (error instanceof ServiceError) {
      return false;
    }
    throw error;
  }
}
