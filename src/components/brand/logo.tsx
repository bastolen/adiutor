/**
 * @file The logo: the one a staff Admin uploaded (decision 0052), or
 * Adiutor's, switching to its light-text version in dark mode.
 */
'use client';

import Image from 'next/image';

import { useBrandLogo } from './brand-logo';

/** Adiutor's logo's width-to-height ratio, from the SVG's viewBox. */
const ADIUTOR_RATIO = 416.09 / 95.5;

/**
 * Props for {@link Logo}.
 */
interface LogoProps {
  /** Height in pixels. Defaults to 40. */
  height?: number;
  /** Load it with high priority (for the first thing on the page). */
  priority?: boolean;
}

/**
 * The logo. Decorative: wrap it in a link or heading with an accessible
 * name.
 *
 * An uploaded logo shows as it is in both modes (one logo, by the staff
 * Admins' choice), at the given height and its own width; where the room is
 * narrower, it shrinks to fit, keeping its shape.
 *
 * @returns The uploaded logo, or both versions of Adiutor's; CSS shows the
 *   one for the current mode.
 */
export default function Logo({ height = 40, priority = false }: LogoProps) {
  const uploaded = useBrandLogo();
  if (uploaded) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Served by Adiutor at its own size and version; the image optimizer would only fetch and copy it again.
      <img
        src={uploaded.src}
        alt=""
        width={Math.round((height * uploaded.width) / uploaded.height)}
        height={height}
        fetchPriority={priority ? 'high' : undefined}
        className="max-w-full object-contain object-left"
      />
    );
  }
  const width = Math.round(height * ADIUTOR_RATIO);
  return (
    <>
      {/* The standard logo has dark text, so dark mode uses the light-text version. */}
      <Image
        src="/brand/logo.svg"
        alt=""
        width={width}
        height={height}
        priority={priority}
        className="dark:hidden"
      />
      <Image
        src="/brand/logo-on-dark.svg"
        alt=""
        width={width}
        height={height}
        priority={priority}
        className="hidden dark:block"
      />
    </>
  );
}
