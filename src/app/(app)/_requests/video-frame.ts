/**
 * @file Draws a frame of a video the uploader chose, in their browser, for
 * the video's preview (decision 0057): the server can't decode videos. The
 * video plays nowhere: a muted element that's never shown loads the file
 * from its `blob:` address (the page's `media-src blob:`), goes to a moment
 * a little way in, and that frame is drawn on a canvas no larger than
 * `VIDEO_FRAME_SIZE` and kept as a JPEG. A video the browser can't decode
 * (an HEVC `.mov` in Chrome, say) gives nothing, and keeps its icon.
 */
import { VIDEO_FRAME_MAX_BYTES, VIDEO_FRAME_SIZE } from '@/lib/requests';

/** How long drawing a frame may take, in milliseconds: a video that hasn't loaded by then gives nothing. */
const FRAME_TIMEOUT_MS = 10_000;

/** How far into a video its frame is taken, in seconds: past a fade-in, rarely past the start. */
const FRAME_AT_SECONDS = 1;

/** The JPEG quality of a frame. */
const FRAME_QUALITY = 0.8;

/**
 * Where in a video its frame is taken: a second in, or a tenth of the way
 * for a shorter one, or its start when it doesn't say how long it is (a
 * recording made in a browser).
 *
 * @param duration - The video's length in seconds, as the browser read it.
 * @returns The moment, in seconds.
 */
export function frameMoment(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.min(FRAME_AT_SECONDS, duration / 10) : 0;
}

/**
 * Draws a frame of a video.
 *
 * @param video - The video file.
 * @returns The frame as a JPEG, or `null` when the browser can't draw one.
 */
export default function drawVideoFrame(video: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const address = URL.createObjectURL(video);
    const element = document.createElement('video');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    /**
     * Ends with a frame or without, and lets the video go.
     *
     * @param frame - The frame, or `null`.
     */
    const finish = (frame: Blob | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(address);
      resolve(frame && frame.size <= VIDEO_FRAME_MAX_BYTES ? frame : null);
    };
    /** Draws the frame the video shows now. */
    const draw = () => {
      const { videoWidth, videoHeight } = element;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!videoWidth || !videoHeight || !context) {
        finish(null);
        return;
      }
      const scale = Math.min(1, VIDEO_FRAME_SIZE / Math.max(videoWidth, videoHeight));
      canvas.width = Math.max(1, Math.round(videoWidth * scale));
      canvas.height = Math.max(1, Math.round(videoHeight * scale));
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(finish, 'image/jpeg', FRAME_QUALITY);
    };
    element.muted = true;
    element.playsInline = true;
    element.preload = 'auto';
    element.addEventListener('error', () => finish(null));
    element.addEventListener(
      'loadeddata',
      () => {
        const moment = frameMoment(element.duration);
        if (moment > 0) {
          element.addEventListener('seeked', draw, { once: true });
          element.currentTime = moment;
        } else {
          draw();
        }
      },
      { once: true },
    );
    timer = setTimeout(() => finish(null), FRAME_TIMEOUT_MS);
    element.src = address;
  });
}
